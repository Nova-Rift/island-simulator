/** Independent conversations/solo agents; one in-flight decision per conversation. */
export class SocialRunner {
  constructor({game,decide,assess=async()=>{},onEvent=()=>{},onBusy=()=>{},onError=()=>{},onDone=()=>{},delay=()=>0}) {
    Object.assign(this,{game,decide,assess,onEvent,onBusy,onError,onDone,delay});
    this.jobs=new Map();this.running=false;this.generation=0;this.timer=null;this.finished=false;
  }
  start(continuous=true){this.running=continuous;this.pump(!continuous)}
  pause(){this.running=false;clearTimeout(this.timer)}
  stop(){this.pause();this.generation++;this.jobs.clear();this.onBusy([])}
  pump(single=false){
    if(!this.running&&!single)return;
    const g=this.game;
    if(g.done){if(!this.jobs.size&&!this.finished){this.finished=true;this.running=false;this.onDone(g.frame())}return}
    // Voting starts after every last social exchange and its assessments finish.
    if(g.phase==='vote'&&[...this.jobs.values()].some(j=>j.phase==='social'))return;
    const candidates=g.remaining.filter(id=>g.legalActions(id).length).sort((a,b)=>g.actionCounts[a]-g.actionCounts[b]||a-b);
    for(const actor of candidates){
      if(this.jobs.has(actor))continue;
      const group=g.phase==='social'?g.groupOf(actor):null;
      const members=group&&group.members.length>1?group.members.slice():[actor];
      if([...this.jobs.values()].some(job=>job.members.some(id=>members.includes(id))))continue;
      const observation=g.observe(actor),job={actor,members,phase:g.phase,generation:this.generation};
      this.jobs.set(actor,job);this.onBusy([...this.jobs.keys()]);void this.run(job,observation);
      if(single)break;
    }
  }
  async run(job,observation){
    const active=()=>job.generation===this.generation;
    try{
      const action=await this.decide(observation);
      if(!active())return;
      // Invitations, admissions, speech or other private notifications may have
      // arrived while thinking. Recompute only this agent, not unrelated lanes.
      if(JSON.stringify(this.game.observe(job.actor))!==JSON.stringify(observation))return;
      const result=this.game.step(action,'llm',job.actor);this.onEvent(result);
      if(result.event.type==='say')await this.assess(result);
    }catch(error){if(active()){this.stop();this.onError(error)}}
    finally{
      if(active()){
        this.jobs.delete(job.actor);this.onBusy([...this.jobs.keys()]);
        if(this.game.done&&!this.jobs.size&&!this.finished){this.finished=true;this.running=false;this.onDone(this.game.frame())}
        else if(this.running){clearTimeout(this.timer);this.timer=setTimeout(()=>this.pump(),this.delay())}
      }
    }
  }
}
