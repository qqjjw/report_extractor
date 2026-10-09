// Runs in the viewer's main page, keeping the iframe src and its document in sync.
function navigateContent(target, expected) {
  const keys=['rcpNo','dcmNo','eleId','offset','length','dtd'];
  const same=(a,b)=>{try{const x=new URL(a,location.href),y=new URL(b,location.href);return x.origin===y.origin && x.pathname===y.pathname && keys.every(k=>x.searchParams.get(k)===y.searchParams.get(k));}catch{return false;}};
  const frames=[...document.querySelectorAll('iframe,frame')].filter(frame=>{try{const u=new URL(frame.src,location.href);return u.hostname==='dart.fss.or.kr' && u.pathname==='/report/viewer.do';}catch{return false;}});
  const frame=expected ? frames.find(frame=>same(frame.src,expected)) : frames.find(frame=>same(frame.src,target)) || frames[0];
  if(!frame)return false;
  frame.setAttribute('src',target);return true;
}
const script=(target,expected)=>`(${navigateContent.toString()})(${JSON.stringify(target)},${JSON.stringify(expected||null)})`;
module.exports={navigateContent,script};
