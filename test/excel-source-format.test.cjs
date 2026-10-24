const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceFormat,color}=require('../excel-source-format.cjs');
test('CSS colors and borders map without inventing a theme',()=>{
  assert.equal(color('rgb(222, 235, 255)'),'#DEEBFF');assert.equal(color('rgba(0, 0, 0, 0)'),undefined);
  const f=sourceFormat({fill:'rgb(222, 235, 255)',color:'rgb(0, 0, 0)',fontSize:'12px',fontWeight:'700',textAlign:'right',verticalAlign:'middle',borders:{top:{style:'solid',width:'1px',color:'rgb(128, 128, 128)'}}});
  assert.equal(f.fill,'#DEEBFF');assert.equal(f.font.size,9);assert.equal(f.font.bold,true);
  assert.deepEqual(f.borders.top,{style:'thin',color:'#808080'});assert.equal(f.horizontalAlignment,'right');
  assert.equal(sourceFormat({}).fill,undefined);
});
