'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = 'D:/Multi-Agent/_runtime/public-validation';
function directory(value) {
  const resolved = path.resolve(value);
  if (!/^[Dd]:[\\/]/u.test(resolved)) throw new Error('QA output must be on D:');
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
module.exports = {
  root,
  temp: directory(path.join(runtime, 'temp')),
  output: name => directory(process.env.MULTI_AGENT_QA_OUTPUT || path.join(runtime, name)),
  executable: () => process.env.MULTI_AGENT_QA_EXECUTABLE || require('electron'),
  args: executable => ['--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', ...(/[\\/]electron\.exe$/iu.test(executable) ? [root] : [])]
};
