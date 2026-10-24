// Generic CSS-to-Excel mapping. No accounting labels, unit inference or table-specific rules.
function color(value){
  if(/^#[\da-f]{6}$/i.test(value||''))return value.toUpperCase();
  const rgb=String(value||'').match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:[, /]+([\d.]+))?\s*\)$/);
  if(!rgb||rgb[4]==='0')return undefined;
  return '#'+rgb.slice(1,4).map(x=>Number(x).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function sourceFormat(s={}){
  const font={};
  if(s.fontFamily)font.name=s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g,'');
  if(parseFloat(s.fontSize))font.size=parseFloat(s.fontSize)*0.75;
  if(color(s.color))font.color=color(s.color);
  if(s.fontWeight)font.bold=s.fontWeight==='bold'||parseInt(s.fontWeight)>=600;
  if(s.fontStyle)font.italic=s.fontStyle==='italic';
  const f={font,wrapText:true};
  if(color(s.fill))f.fill=color(s.fill);
  const horizontal={start:'left',end:'right',left:'left',right:'right',center:'center',justify:'justify'}[s.textAlign];
  if(horizontal)f.horizontalAlignment=horizontal;
  if(s.verticalAlign)f.verticalAlignment=s.verticalAlign==='middle'?'center':s.verticalAlign==='bottom'?'bottom':'top';
  const borders={};
  for(const [edge,b]of Object.entries(s.borders||{})){
    if(b.style==='none'||b.style==='hidden'||!parseFloat(b.width))continue;
    borders[edge]={style:['double','dotted','dashed'].includes(b.style)?b.style:parseFloat(b.width)>2?'medium':'thin',...(color(b.color)?{color:color(b.color)}:{})};
  }
  if(Object.keys(borders).length)f.borders=borders;
  return f;
}
module.exports={color,sourceFormat};
