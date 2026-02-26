import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR_NAME = ".uniform-instance-manager";
const AUTH_FILE_NAME = "auth.json";
const PREFS_FILE_NAME = "prefs.json";

/**
 * Returns the path to the configuration directory (~/.uniform-instance-manager).
 */
export function getConfigDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/**
 * Saves authentication credentials to disk.
 *
 * @param {string} host - The Uniform host URL (e.g. "https://canary.uniform.app")
 * @param {string} accessToken - The JWT access token
 * @param {number} expiresIn - Token lifetime in seconds from now
 */
export function saveAuth(host, accessToken, expiresIn) {
  const configDir = getConfigDir();
  const authFilePath = path.join(configDir, AUTH_FILE_NAME);

  const authData = {
    host,
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(authFilePath, JSON.stringify(authData, null, 2), "utf-8");
}

/**
 * Loads authentication credentials from disk.
 *
 * @returns {{ host: string, accessToken: string, expiresAt: number }}
 * @throws {Error} If the auth file is not found or the token has expired
 */
export function loadAuth() {
  const configDir = getConfigDir();
  const authFilePath = path.join(configDir, AUTH_FILE_NAME);

  if (!fs.existsSync(authFilePath)) {
    throw new Error(
      `Auth file not found at ${authFilePath}. Please log in first.`
    );
  }

  const raw = fs.readFileSync(authFilePath, "utf-8");
  const authData = JSON.parse(raw);

  if (!authData.host || !authData.accessToken || !authData.expiresAt) {
    throw new Error("Auth file is malformed. Please log in again.");
  }

  if (Date.now() >= authData.expiresAt) {
    throw new Error("Access token has expired. Please log in again.");
  }

  return authData;
}

/**
 * Saves a preference value to disk.
 *
 * @param {string} key - The preference key
 * @param {*} value - The value to store
 */
export function savePref(key, value) {
  const configDir = getConfigDir();
  const prefsPath = path.join(configDir, PREFS_FILE_NAME);

  let prefs = {};
  if (fs.existsSync(prefsPath)) {
    prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
  }

  prefs[key] = value;

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), "utf-8");
}

/**
 * Loads a preference value from disk.
 *
 * @param {string} key - The preference key
 * @returns {*} The stored value, or undefined if not set
 */
export function loadPref(key) {
  const prefsPath = path.join(getConfigDir(), PREFS_FILE_NAME);
  if (!fs.existsSync(prefsPath)) return undefined;
  const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
  return prefs[key];
}
