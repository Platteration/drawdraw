// app.json is the configuration; this adds the one thing it cannot hold, the path the website
// is served under. A site at the root of its own domain needs none; one at a sub-path (a GitHub
// Pages project site, <user>.github.io/drawdraw/) needs every address the export writes to
// start with that path. scripts/build-web.mjs sets WEB_BASE_URL for its own export, so the dev
// server, the native builds, the config test and a plain `expo export` read app.json exactly as
// it is written.
module.exports = ({ config }) => {
  const baseUrl = process.env.WEB_BASE_URL;
  if (!baseUrl) return config;
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(baseUrl)) {
    throw new Error(`WEB_BASE_URL is a path such as /drawdraw, not ${JSON.stringify(baseUrl)}`);
  }
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};
