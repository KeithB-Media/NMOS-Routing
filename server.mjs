import {createRouteDesk} from './route-server.mjs';
const app=await createRouteDesk();
console.log(`NMOS Routing (${app.snapshot().mode}): ${app.url}`);
const stop=()=>void app.close().then(()=>process.exit(0));
process.on('SIGTERM',stop);process.on('SIGINT',stop);
