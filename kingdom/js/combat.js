export const spells = [
  { id:'fire', color:'#ff9c62', effect:'burn', cost:9, cooldown:.8 },
  { id:'ice', color:'#93eaff', effect:'freeze', cost:9, cooldown:.9 },
  null, // Slot 3 remains the healing item.
  { id:'thunder', color:'#f7d768', effect:'shock', cost:10, cooldown:1 },
];

export function segmentHits(a, b, [x,y,w,h], padding = 0) {
  let start = 0, end = 1;
  for (const [p,d,min,max] of [
    [a.x,b.x-a.x,x-padding,x+w+padding],
    [a.y,b.y-a.y,y-padding,y+h+padding],
  ]) {
    if (d === 0) {
      if (p < min || p > max) return false;
      continue;
    }
    const t1 = (min-p)/d, t2 = (max-p)/d;
    start = Math.max(start,Math.min(t1,t2));
    end = Math.min(end,Math.max(t1,t2));
    if (start > end) return false;
  }
  return true;
}

// A sparse grid search returns the next visible waypoint around obstacles.
export function waypoint(from, to, clear, blocked, width, height) {
  const size = 12;
  const origin = { x:Math.round(from.x/size), y:Math.round(from.y/size) };
  const seen = new Set([origin.x+','+origin.y]);
  const queue = [{...origin, point:from, first:null}];
  for (const node of queue) {
    if (clear(node.point,to)) return node.first ?? to;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x=node.x+dx, y=node.y+dy, key=x+','+y;
      if (seen.has(key) || x<0 || y<0 || x*size>=width || y*size>=height) continue;
      const point = {x:x*size,y:y*size};
      if (blocked(point) || !clear(node.point,point)) continue;
      seen.add(key);
      queue.push({x,y,point,first:node.first ?? point});
    }
  }
  return null;
}
