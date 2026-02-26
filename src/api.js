import { httpRequest } from "./auth.js";

const GET_USER_INFO_QUERY = `
query GetUserInfo($subject: String!) {
  info: identities_by_pk(subject: $subject) {
    name
    email_address
    teams: organizations_identities(order_by: { organization: { name: asc } }) {
      team: organization {
        name
        id
        sites {
          name
          id
        }
      }
    }
  }
}`;

/**
 * Decodes a JWT token and returns the payload.
 */
function decodeJwt(token) {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64").toString());
}

/**
 * Fetches user info (name, email, teams, and their projects) via GraphQL.
 *
 * @param {string} host - The Uniform host URL
 * @param {string} accessToken - JWT access token
 * @returns {Promise<{ name: string, email_address: string, teams: Array }>}
 */
export async function getUserInfo(host, accessToken) {
  const { sub } = decodeJwt(accessToken);

  const response = await httpRequest(`${host}/v1/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: GET_USER_INFO_QUERY,
      variables: { subject: sub },
    }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `getUserInfo failed with status ${response.status}: ${response.body}`
    );
  }

  const parsed = JSON.parse(response.body);

  if (parsed.errors) {
    throw new Error(
      `GraphQL errors: ${JSON.stringify(parsed.errors)}`
    );
  }

  return parsed.data.info;
}

/**
 * Checks the project limits for a given team.
 *
 * @param {string} host - The Uniform host URL
 * @param {string} accessToken - JWT access token
 * @param {string} teamId - The team (organization) ID
 * @returns {Promise<object>} The limits response body
 */
export async function getProjectLimits(host, accessToken, teamId) {
  const response = await httpRequest(
    `${host}/api/v1/limits?teamId=${teamId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  // 402 Payment Required means SOME limit is exceeded but response still has data
  if (response.status !== 402 && (response.status < 200 || response.status >= 300)) {
    throw new Error(
      `getProjectLimits failed with status ${response.status}: ${response.body}`
    );
  }

  return JSON.parse(response.body);
}

/**
 * Creates a new project in a team.
 *
 * @param {string} host - The Uniform host URL
 * @param {string} accessToken - JWT access token
 * @param {string} teamId - The team (organization) ID
 * @param {string} name - The project name
 * @param {string} projectTypeId - The project type ID
 * @returns {Promise<{ id: string }>} The created project with its UUID
 */
export async function createProject(
  host,
  accessToken,
  teamId,
  name,
  projectTypeId
) {
  const response = await httpRequest(`${host}/api/v1/project`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      teamId,
      name,
      projectTypeId,
      uiVersion: 3,
    }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `createProject failed with status ${response.status}: ${response.body}`
    );
  }

  return JSON.parse(response.body);
}

/**
 * Deletes a project.
 *
 * @param {string} host - The Uniform host URL
 * @param {string} accessToken - JWT access token
 * @param {string} projectId - The project ID to delete
 * @returns {Promise<void>}
 */
export async function deleteProject(host, accessToken, projectId) {
  const response = await httpRequest(`${host}/api/v1/project`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `deleteProject failed with status ${response.status}: ${response.body}`
    );
  }
}

/**
 * Adds a locale to a project.
 *
 * @param {string} host - The Uniform host URL
 * @param {string} accessToken - JWT access token
 * @param {string} projectId - The project ID
 * @param {string} locale - The locale code (e.g. "en-US")
 * @param {string} displayName - The locale display name (e.g. "English (US)")
 * @returns {Promise<void>}
 */
export async function addLocale(
  host,
  accessToken,
  projectId,
  locale,
  displayName
) {
  const response = await httpRequest(`${host}/api/v1/locales`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId,
      locale: {
        locale,
        displayName,
        isDefault: true,
      },
    }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `addLocale failed with status ${response.status}: ${response.body}`
    );
  }
}
