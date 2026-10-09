const fs=require('node:fs');
const path=require('node:path');
function guestBundle(directory){
  // Sandboxed Electron preloads expose module, but require supports only a small
  // built-in allowlist. Force browser UMD branches for our bundled libraries.
  const libraries=['table-dom.js','table-rules.js','table-live.js'].map(file=>fs.readFileSync(path.join(directory,'src','tables',file),'utf8')).join('\n');
  return `(function(module){\n${libraries}\n})(undefined);\n`+fs.readFileSync(path.join(directory,'src','main','guest-preload.js'),'utf8');
}
module.exports={guestBundle};
