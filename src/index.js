import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { authenticate, authenticateWithBrowser } from './auth.js';
import { saveAuth, loadAuth, savePref, loadPref } from './config.js';
import { getUserInfo, getProjectLimits, createProject, deleteProject, addLocale } from './api.js';

program
  .name('uniform-instance-manager')
  .description('CLI tool for managing Uniform instances')
  .version('1.0.0');

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
      const envPath = path.resolve('.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
        // Replace existing UNIFORM_PROJECT_ID if present
        if (/^UNIFORM_PROJECT_ID=.*/m.test(envContent)) {
          envContent = envContent.replace(/^UNIFORM_PROJECT_ID=.*/m, `UNIFORM_PROJECT_ID=${projectId}`);
        } else {
          envContent = envContent.trimEnd() + '\n' + `UNIFORM_PROJECT_ID=${projectId}\n`;
        }
      } else {
        envContent = `UNIFORM_PROJECT_ID=${projectId}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf-8');
      console.log(`UNIFORM_PROJECT_ID=${projectId} written to ${envPath}`);

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
  .description('List all projects accessible to the current user')
  .action(async (filter) => {
    try {
      const { host, accessToken } = loadAuth();

      const userInfo = await getUserInfo(host, accessToken);
      if (!userInfo || !userInfo.teams || userInfo.teams.length === 0) {
        throw new Error('No teams found for this user.');
      }

      const regex = filter ? globToRegex(filter) : null;

      for (const { team } of userInfo.teams) {
        const projects = regex
          ? team.sites.filter((s) => regex.test(s.name))
          : team.sites;

        if (projects.length === 0) continue;

        console.log(`${team.name} (${team.id})`);
        for (const site of projects) {
          console.log(`  ${site.name}  ${site.id}`);
        }
      }
    } catch (err) {
      console.error(`Failed to list projects: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
