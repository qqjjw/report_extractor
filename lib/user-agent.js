// Keep Chromium's real platform/version, but omit Electron application tokens.
function browserUserAgent(userAgent) {
  return userAgent.replace(/\s(?:Electron|dart-report-collector)\/\S+/gi, '');
}
module.exports = { browserUserAgent };
