import https from 'https';
import crypto from 'crypto';

const CLIENT_ID = 'HskAkzfjRf6nF1XVOJVnaifGTFl9QgUR';
const AUDIENCE = 'https://optimize.uniform.dev';

/**
 * Low-level HTTP request helper using Node.js built-in https module.
 * Follows no redirects automatically — returns status, headers, and body.
 *
 * @param {string} url - Fully qualified URL to request.
 * @param {object} [opts] - Options: method, headers, body.
 * @returns {Promise<{status: number, headers: object, body: string}>}
 */
export function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = opts.body || '';
    const reqOpts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        ...(opts.headers || {}),
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };

    const r = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data })
      );
    });

    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

/**
 * Extract and append Set-Cookie values from a response to an existing cookie string.
 *
 * @param {string} existing - Current accumulated cookie string.
 * @param {object} headers - Response headers object.
 * @returns {string} Updated cookie string.
 */
function accumulateCookies(existing, headers) {
  const setCookies = (headers['set-cookie'] || [])
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!setCookies) return existing;
  return existing ? existing + '; ' + setCookies : setCookies;
}

/**
 * Resolve a potentially relative Location header to an absolute URL.
 *
 * @param {string} location - The Location header value.
 * @param {string} baseOrigin - The origin to prepend for relative paths.
 * @returns {string}
 */
function resolveLocation(location, baseOrigin) {
  if (!location) return '';
  return location.startsWith('/') ? baseOrigin + location : location;
}

/**
 * Derive the Auth0 login domain from a Uniform host URL.
 *
 * Examples:
 *   "https://canary.uniform.app" -> "canary-login.uniform.app"
 *   "https://uniform.app"        -> "login.uniform.app"
 *
 * @param {string} host - The Uniform host URL (e.g. "https://canary.uniform.app").
 * @returns {string} The Auth0 login domain.
 */
function deriveLoginDomain(host) {
  const hostname = new URL(host).hostname; // e.g. "canary.uniform.app" or "uniform.app"
  const parts = hostname.split('.');

  // If there are 3+ parts, the first is the subdomain (e.g. "canary" from "canary.uniform.app")
  // If only 2 parts (e.g. "uniform.app"), there is no subdomain.
  if (parts.length >= 3) {
    const subdomain = parts[0];
    const baseDomain = parts.slice(1).join('.');
    return `${subdomain}-login.${baseDomain}`;
  }
  return `login.${hostname}`;
}

/**
 * Authenticate with Uniform's Auth0-based login system using the PKCE flow.
 *
 * @param {string} host - The Uniform host URL (e.g. "https://canary.uniform.app").
 * @param {string} username - The user's email address.
 * @param {string} password - The user's password.
 * @returns {Promise<{accessToken: string, expiresIn: number}>}
 */
export async function authenticate(host, username, password) {
  // Normalize host — strip trailing slash, derive origin and login domain
  const origin = new URL(host).origin; // e.g. "https://canary.uniform.app"
  const loginDomain = deriveLoginDomain(host);
  const loginOrigin = `https://${loginDomain}`;

  // Generate PKCE code verifier and challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  let cookies = '';

  // ── Step 1: GET /authorize → redirects to /u/login/identifier ──

  const authorizeParams = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: origin,
    scope: 'openid profile email',
    audience: AUDIENCE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();

  const r1 = await httpRequest(
    `${loginOrigin}/authorize?${authorizeParams}`
  );

  if (!r1.headers.location) {
    throw new Error(
      `Authentication failed at /authorize: expected redirect, got status ${r1.status}`
    );
  }

  cookies = accumulateCookies(cookies, r1.headers);
  const loginPageUrl = resolveLocation(r1.headers.location, loginOrigin);
  const loginState = new URL(loginPageUrl).searchParams.get('state');

  if (!loginState) {
    throw new Error(
      'Authentication failed: no state parameter returned from /authorize redirect'
    );
  }

  // ── Step 2: GET login identifier page (collect cookies) ──

  const r2 = await httpRequest(loginPageUrl, {
    headers: { Cookie: cookies },
  });
  cookies = accumulateCookies(cookies, r2.headers);

  // ── Step 3: POST username to /u/login/identifier ──

  const identifierBody = new URLSearchParams({
    state: loginState,
    username,
    'js-available': 'true',
    'webauthn-available': 'true',
    'is-brave': 'false',
    'webauthn-platform-available': 'false',
    action: 'default',
  }).toString();

  const r3 = await httpRequest(
    `${loginOrigin}/u/login/identifier?state=${loginState}`,
    {
      method: 'POST',
      body: identifierBody,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
      },
    }
  );

  if (!r3.headers.location) {
    throw new Error(
      `Authentication failed at /u/login/identifier: expected redirect, got status ${r3.status}. ` +
        'The username may be invalid or the account may not exist.'
    );
  }

  cookies = accumulateCookies(cookies, r3.headers);

  // ── Step 4: GET password page (collect cookies) ──

  const passwordPageUrl = resolveLocation(r3.headers.location, loginOrigin);
  const r4 = await httpRequest(passwordPageUrl, {
    headers: { Cookie: cookies },
  });
  cookies = accumulateCookies(cookies, r4.headers);

  // ── Step 5: POST password to /u/login/password ──

  const passwordBody = new URLSearchParams({
    state: loginState,
    username,
    password,
    action: 'default',
  }).toString();

  const r5 = await httpRequest(
    `${loginOrigin}/u/login/password?state=${loginState}`,
    {
      method: 'POST',
      body: passwordBody,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
      },
    }
  );

  if (!r5.headers.location) {
    throw new Error(
      `Authentication failed: invalid credentials. ` +
        `POST /u/login/password returned status ${r5.status} with no redirect.`
    );
  }

  cookies = accumulateCookies(cookies, r5.headers);

  // ── Step 6: Follow redirect to /authorize/resume → get auth code ──

  const resumeUrl = resolveLocation(r5.headers.location, loginOrigin);

  if (!resumeUrl.includes('/authorize/resume')) {
    throw new Error(
      `Authentication failed: expected redirect to /authorize/resume, got: ${resumeUrl}. ` +
        'Credentials may be invalid.'
    );
  }

  const r6 = await httpRequest(resumeUrl, {
    headers: { Cookie: cookies },
  });

  if (!r6.headers.location) {
    throw new Error(
      `Authentication failed at /authorize/resume: expected redirect with auth code, got status ${r6.status}`
    );
  }

  const callbackUrl = new URL(r6.headers.location);
  const code = callbackUrl.searchParams.get('code');

  if (!code) {
    const error = callbackUrl.searchParams.get('error');
    const errorDesc = callbackUrl.searchParams.get('error_description');
    throw new Error(
      `Authentication failed: no authorization code received.` +
        (error ? ` Error: ${error} — ${errorDesc}` : '')
    );
  }

  // ── Step 7: Exchange authorization code for access token ──

  const tokenBody = JSON.stringify({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: origin,
    code_verifier: codeVerifier,
  });

  const tokenRes = await httpRequest(`${loginOrigin}/oauth/token`, {
    method: 'POST',
    body: tokenBody,
    headers: { 'Content-Type': 'application/json' },
  });

  let tokenData;
  try {
    tokenData = JSON.parse(tokenRes.body);
  } catch {
    throw new Error(
      `Authentication failed: could not parse token response. Status: ${tokenRes.status}, body: ${tokenRes.body}`
    );
  }

  if (!tokenData.access_token) {
    throw new Error(
      `Authentication failed: token exchange returned error. ` +
        `${tokenData.error || 'Unknown error'}: ${tokenData.error_description || tokenRes.body}`
    );
  }

  return {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
  };
}
