/**
 * Step R2 (docs/architecture/global-geography.md) renamed LAD ids uk:borough:<code> -> uk:lad:<code>. What this browser
 * saved before (saved areas, compare, shortlists, the search, the map's last view, checklists: every
 * `close-knit*` localStorage value) is rewritten once, before the page's code reads it, so every reader sees current
 * ids only. Values without an old id are not touched; blocked storage is skipped. The API and shared links read old
 * ids themselves (api/area_api/id_alias.py, contracts.ts canonicalAreaIds).
 */
export const AREA_ID_BOOT = `try{var s=window.localStorage,o="uk:borough:",i,k,v;`
  + `for(i=0;i<s.length;i++){k=s.key(i);if(k&&k.indexOf("close-knit")===0){v=s.getItem(k);`
  + `if(v&&v.indexOf(o)>=0)s.setItem(k,v.split(o).join("uk:lad:"))}}}catch(e){}`;
