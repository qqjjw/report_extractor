// HTML cell anchors; never rearrange, repeat or aggregate source data.
function tableGrid(rows){
  const occupied=[],cells=[];let width=0;
  rows.forEach((row,r)=>{occupied[r]||=[];let c=0;
    for(const source of row){
      while(occupied[r][c])c++;
      const rs=source.rowSpan||1,cs=source.colSpan||1;
      for(let y=r;y<r+rs;y++){occupied[y]||=[];for(let x=c;x<c+cs;x++){
        if(occupied[y][x])throw Error('원문 병합 셀이 겹칩니다.');occupied[y][x]=true;
      }}
      cells.push({r,c,rs,cs,...source});c+=cs;width=Math.max(width,c);
    }
  });
  return {cells,width,height:occupied.length};
}
module.exports={tableGrid};
