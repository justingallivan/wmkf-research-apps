/** Fail-closed local rehearsal boundary. No Production cutover capability. */
const {parse}=require('pg-connection-string');
function enabled(env=process.env){const value=env.EXPERTISE_ROSTER_REHEARSAL;if(value===undefined||value===''||value==='off')return false;if(value!=='on')throw Error('Invalid roster rehearsal setting');return true;}
function assertTarget(env=process.env){
 if(!enabled(env))throw Error('Roster rehearsal is not enabled');
 if(env.VERCEL_ENV==='production'||env.DYNAMICS_URL!=='https://orgd9e66399.crm.dynamics.com'||(env.DYNAMICS_SANDBOX_URL&&env.DYNAMICS_SANDBOX_URL!==env.DYNAMICS_URL)||env.DATAVERSE_TARGET_INTERLOCK!=='on'||env.DATAVERSE_DAL_ENFORCEMENT!=='on')throw Error('Roster rehearsal requires the registered sandbox with enforcement enabled');
 const raw=env.POSTGRES_URL;if(!raw)throw Error('Rehearsal database required');const u=new URL(raw),p=parse(raw);
 if(u.search||u.hash||p.host!=='127.0.0.1'||p.port!=='55439'||p.database!=='roster_rehearsal'||p.user!=='roster_rehearsal')throw Error('Roster rehearsal refuses shared or remote Postgres');
 for(const k of ['DATABASE_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL'])if(env[k]!==raw)throw Error('All rehearsal database aliases must match');
 return {host:'orgd9e66399.crm.dynamics.com',connectionString:raw};
}
module.exports={enabled,assertTarget};
