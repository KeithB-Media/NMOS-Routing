import {routeCompatibility,supportsSide} from './route-options.js';

export function matrixColumns(groups,side,mode,queryTest=()=>true) {
  const opposite=side==='destination'?'source':'destination';
  return groups.filter(g=>supportsSide(g,opposite)).flatMap(g=>mode==='endpoints'
    ?g.levels.map(level=>({g,level,label:`${g.name} · ${level.name}`}))
    :[{g,label:g.name}]).filter(item=>queryTest([item.label,item.g.system,...Object.values(item.g.aliases||{})]));
}

export function matrixCrosspoint(row,column,side,routesByDestination,lockedEndpoints,policy) {
  const source=side==='destination'?column.g:row.g,destination=side==='destination'?row.g:column.g;
  const sourceLevel=side==='destination'?column.level:row.level,destinationLevel=side==='destination'?row.level:column.level;
  // Endpoint crosspoints must describe the same content ID on both axes.
  if((sourceLevel||destinationLevel)&&(!sourceLevel||!destinationLevel||sourceLevel.key!==destinationLevel.key))return {status:'unavailable',reason:'Different content IDs',active:false};
  const levelKey=destinationLevel?.key;
  const plan=routeCompatibility(source,destination,levelKey,lockedEndpoints,policy);
  const matched=plan.matches.filter(level=>(routesByDestination.get(level.id)||[]).some(route=>route.from===source.levels.find(l=>l.key===level.key)?.id)).length;
  return {...plan,source,destination,levelKey,active:matched>0&&matched===plan.required.length,partial:matched>0&&matched<plan.required.length};
}
