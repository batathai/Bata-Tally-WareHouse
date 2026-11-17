import { createMenus3D } from './bata-menus-3d.engine.js';
let inst=null;
export function get(){ if(!inst) inst=createMenus3D(); return inst; }
export function show(key,host,cards){ get().show(key,host,cards); }
export function hide(){ if(inst) inst.hide(); }
