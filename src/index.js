import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { authenticate, authenticateWithBrowser } from './auth.js';
import { saveAuth, loadAuth, savePref, loadPref } from './config.js';
import { getUserInfo, getProjectLimits, createProject, deleteProject, addLocale, getProjectMaps, deleteProjectMap } from './api.js';

program
  .name('uniform-instance-manager')
  .description('CLI tool for managing Uniform instances')
  .version('1.0.0');

/**
 * Write UNIFORM_PROJECT_ID to the .env file in the current directory.
 */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function writeProjectToEnv(projectId) {
  const envPath = path.resolve('.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
    if (/^UNIFORM_PROJECT_ID=.*/m.test(envContent)) {
      envContent = envContent.replace(/^UNIFORM_PROJECT_ID=.*/m, `UNIFORM_PROJECT_ID=${projectId}`);
    } else {
      envContent = envContent.trimEnd() + '\n' + `UNIFORM_PROJECT_ID=${projectId}\n`;
    }

    // If UNIFORM_PREVIEW_SECRET exists and is a valid GUID, update it to match projectId
    const previewSecretMatch = envContent.match(/^UNIFORM_PREVIEW_SECRET=(.*)$/m);
    if (previewSecretMatch && GUID_RE.test(previewSecretMatch[1])) {
      envContent = envContent.replace(/^UNIFORM_PREVIEW_SECRET=.*/m, `UNIFORM_PREVIEW_SECRET=${projectId}`);
      console.log(`UNIFORM_PREVIEW_SECRET=${projectId} written to ${envPath}`);
    }
  } else {
    envContent = `UNIFORM_PROJECT_ID=${projectId}\n`;
  }
  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log(`UNIFORM_PROJECT_ID=${projectId} written to ${envPath}`);
}

// ── login ──────────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with a Uniform instance')
  .requiredOption('--host <url>', 'Uniform host URL (e.g. https://canary.uniform.app/)')
  .option('--username <email>', 'Account email address')
  .option('--password <password>', 'Account password')
  .option('--google', 'Authenticate via Google in the browser')
  .action(async (opts) => {
    try {
      const host = new URL(opts.host).origin; // normalize
      let accessToken, expiresIn;

      if (opts.google) {
        ({ accessToken, expiresIn } = await authenticateWithBrowser(host, { connection: 'google-oauth2' }));
      } else if (opts.username && opts.password) {
        console.log(`Authenticating as ${opts.username} against ${host}...`);
        ({ accessToken, expiresIn } = await authenticate(host, opts.username, opts.password));
      } else {
        console.error('Error: provide --username and --password, or use --google');
        process.exit(1);
      }

      saveAuth(host, accessToken, expiresIn);

      console.log(`Login successful. Token expires in ${Math.floor(expiresIn / 3600)} hours.`);
      console.log('Credentials saved.');
    } catch (err) {
      console.error(`Login failed: ${err.message}`);
      process.exit(1);
    }
  });

// ── use-team ───────────────────────────────────────────────────────────────────

program
  .command('use-team')
  .argument('<teamId>', 'Team ID to use for subsequent commands')
  .description('Set the default team ID for project creation')
  .action((teamId) => {
    savePref('teamId', teamId);
    console.log(`Default team set to: ${teamId}`);
  });

// ── create-project ─────────────────────────────────────────────────────────────

program
  .command('create-project')
  .argument('<name>', 'Name for the new project')
  .option('--teamId <id>', 'Team ID to create the project in (overrides use-team)')
  .description('Create a Uniform project, register English locale, and write UNIFORM_PROJECT_ID to .env')
  .action(async (projectName, opts) => {
    try {
      const { host, accessToken } = loadAuth();
      console.log(`Creating project "${projectName}" on ${host}...`);

      // Resolve team ID: --teamId flag > use-team pref > auto-detect from first team
      let teamId = opts.teamId || loadPref('teamId');
      let teamName;

      if (teamId) {
        teamName = teamId;
        console.log(`Using team: ${teamId}`);
      } else {
        const userInfo = await getUserInfo(host, accessToken);
        if (!userInfo || !userInfo.teams || userInfo.teams.length === 0) {
          throw new Error('No teams found for this user. Please create a team first in the Uniform dashboard.');
        }
        teamId = userInfo.teams[0].team.id;
        teamName = userInfo.teams[0].team.name;
        console.log(`Using team: ${teamName} (${teamId})`);
      }

      // 2. Check project limits to get a valid project type
      const limitsData = await getProjectLimits(host, accessToken, teamId);
      const projectType = limitsData.limits.projects.find((p) => p.used < p.limit);
      if (!projectType) {
        throw new Error('Usage exceeded: cannot create more projects. Please upgrade your plan or delete an existing project.');
      }

      // 3. Create the project
      const { id: projectId } = await createProject(host, accessToken, teamId, projectName, projectType.id);
      console.log(`Project created: ${projectId}`);

      // 4. Register "English" locale (code: "en")
      await addLocale(host, accessToken, projectId, 'en', 'English');
      console.log('Locale registered: English (en)');

      // 5. Write UNIFORM_PROJECT_ID to .env in current directory
      writeProjectToEnv(projectId);

      console.log('Done.');
    } catch (err) {
      console.error(`Failed to create project: ${err.message}`);
      process.exit(1);
    }
  });

// ── delete-project ─────────────────────────────────────────────────────────────

program
  .command('delete-project')
  .argument('<nameOrId>', 'Project name or UUID to delete')
  .description('Delete a Uniform project by name or ID')
  .action(async (nameOrId) => {
    try {
      const { host, accessToken } = loadAuth();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

      let projectId;
      let label;

      if (isUuid) {
        projectId = nameOrId;
        label = projectId;
      } else {
        console.log(`Looking up project "${nameOrId}" on ${host}...`);
        const userInfo = await getUserInfo(host, accessToken);
        if (!userInfo || !userInfo.teams || userInfo.teams.length === 0) {
          throw new Error('No teams found for this user.');
        }

        for (const { team } of userInfo.teams) {
          const site = team.sites.find((s) => s.name === nameOrId);
          if (site) {
            projectId = site.id;
            break;
          }
        }

        if (!projectId) {
          throw new Error(
            `Project "${nameOrId}" not found. Available projects: ${
              userInfo.teams.flatMap((t) => t.team.sites.map((s) => s.name)).join(', ') || '(none)'
            }`
          );
        }
        label = `"${nameOrId}" (${projectId})`;
        console.log(`Found project: ${projectId}`);
      }

      await deleteProject(host, accessToken, projectId);
      console.log(`Project ${label} deleted successfully.`);
    } catch (err) {
      console.error(`Failed to delete project: ${err.message}`);
      process.exit(1);
    }
  });

// ── ls ─────────────────────────────────────────────────────────────────────────

// ── use-project ────────────────────────────────────────────────────────────────

program
  .command('use-project')
  .argument('<nameOrId>', 'Project name or UUID')
  .description('Write UNIFORM_PROJECT_ID to .env in the current directory')
  .action(async (nameOrId) => {
    try {
      const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const urlMatch = nameOrId.includes('/') && nameOrId.match(uuidRe);
      if (urlMatch) nameOrId = urlMatch[0];

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

      if (isUuid) {
        writeProjectToEnv(nameOrId);
      } else {
        const { host, accessToken } = loadAuth();
        const userInfo = await getUserInfo(host, accessToken);
        if (!userInfo || !userInfo.teams || userInfo.teams.length === 0) {
          throw new Error('No teams found for this user.');
        }

        let projectId = null;
        for (const { team } of userInfo.teams) {
          const site = team.sites.find((s) => s.name === nameOrId);
          if (site) {
            projectId = site.id;
            break;
          }
        }

        if (!projectId) {
          throw new Error(
            `Project "${nameOrId}" not found. Use "uim ls --allTeams" to see available projects.`
          );
        }

        writeProjectToEnv(projectId);
      }
    } catch (err) {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

// ── ls ─────────────────────────────────────────────────────────────────────────

/**
 * Convert a simple glob pattern (with * wildcards) to a RegExp.
 * e.g. "*alen*" -> /^.*alen.*$/i
 */
function globToRegex(pattern) {
  const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, '\\$1').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

program
  .command('ls')
  .argument('[filter]', 'Optional glob filter (e.g. *alen*)')
  .option('--allTeams', 'List projects across all teams (default: current team only)')
  .option('--filter <text>', 'Show only projects whose name or id contains the given text (case-insensitive)')
  .description('List projects in the current team (use --allTeams for all)')
  .action(async (filter, opts) => {
    try {
      const { host, accessToken } = loadAuth();
      const savedTeamId = loadPref('teamId');

      if (!opts.allTeams && !savedTeamId) {
        throw new Error('No team selected. Run "uim use-team <teamId>" first, or use --allTeams.');
      }

      const userInfo = await getUserInfo(host, accessToken);
      if (!userInfo || !userInfo.teams || userInfo.teams.length === 0) {
        throw new Error('No teams found for this user.');
      }

      const teams = opts.allTeams
        ? userInfo.teams
        : userInfo.teams.filter(({ team }) => team.id === savedTeamId);

      if (teams.length === 0) {
        throw new Error(`Team ${savedTeamId} not found. Run "uim use-team <teamId>" with a valid team or use --allTeams.`);
      }

      const regex = filter ? globToRegex(filter) : null;
      const substring = opts.filter ? opts.filter.toLowerCase() : null;
      let n = 0;

      for (const { team } of teams) {
        let projects = regex ? team.sites.filter((s) => regex.test(s.name)) : team.sites;
        if (substring) {
          projects = projects.filter((s) => s.name.toLowerCase().includes(substring) || s.id.toLowerCase().includes(substring));
        }

        if (projects.length === 0) continue;

        // Count total projects across all teams for zero-padding width
        const totalCount = teams.reduce((sum, { team: t }) => {
          let s = regex ? t.sites.filter((p) => regex.test(p.name)) : t.sites;
          if (substring) s = s.filter((p) => p.name.toLowerCase().includes(substring) || p.id.toLowerCase().includes(substring));
          return sum + s.length;
        }, 0);
        const padWidth = String(totalCount).length;

        console.log(`${team.name} (${team.id})`);
        for (const site of projects) {
          n++;
          console.log(`  ${String(n).padStart(padWidth, '0')}. ${site.id} ${site.name}`);
        }
      }
    } catch (err) {
      console.error(`Failed to list projects: ${err.message}`);
      process.exit(1);
    }
  });

// ── delete projectmap ───────────────────────────────────────────────────────────

/**
 * Resolve project ID: --projectId flag > UNIFORM_PROJECT_ID in .env
 */
function resolveProjectId(optProjectId) {
  if (optProjectId) return optProjectId;
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf-8').match(/^UNIFORM_PROJECT_ID=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error('No project ID provided. Pass --projectId or set UNIFORM_PROJECT_ID in .env');
}

const deleteCmd = program.command('delete').description('Delete Uniform resources');

deleteCmd
  .command('projectmap [id]')
  .description('Delete a project map (or all project maps with --all)')
  .option('--projectId <id>', 'Project ID (defaults to UNIFORM_PROJECT_ID from .env)')
  .option('--all', 'Delete all project maps in the project')
  .action(async (id, opts) => {
    try {
      const { host, accessToken } = loadAuth();
      const projectId = resolveProjectId(opts.projectId);

      if (opts.all) {
        const maps = await getProjectMaps(host, accessToken, projectId);
        if (maps.length === 0) {
          console.log('No project maps found.');
          return;
        }
        console.log(`Deleting ${maps.length} project map(s)...`);
        for (const map of maps) {
          await deleteProjectMap(host, accessToken, projectId, map.id);
          console.log(`  Deleted: ${map.id}${map.name ? ` (${map.name})` : ''}`);
        }
        console.log('Done.');
      } else {
        if (!id) {
          console.error('Error: provide a project map ID or use --all');
          process.exit(1);
        }
        await deleteProjectMap(host, accessToken, projectId, id);
        console.log(`Project map ${id} deleted successfully.`);
      }
    } catch (err) {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
