// Clock passage alone does not invalidate a decision made from private context.
const context = observation => {const {voteClock,...personal}=observation;return JSON.stringify(personal)};
/** Independent conversations/solo agents; one in-flight decision per conversation. */
export class SocialRunner {
  constructor({game,decide,assess=async()=>{},onEvent=()=>{},onBusy=()=>{},onError=()=>{},onDone=()=>{},delay=()=>0,onClock=()=>{},waitMs=5000,now=()=>performance.now()}) {
    Object.assign(this,{game,decide,assess,onEvent,onBusy,onError,onDone,delay,onClock,waitMs,now});
    this.jobs=new Map();this.running=false;this.generation=0;this.timer=null;this.finished=false;this.waiting=new Map();this.clockTimer=null;this.lastTick=null;this.cycle=game.cycle;
  }
  start(continuous=true){this.running=continuous;if(continuous&&this.clockTimer===null){this.lastTick=this.now();this.clockTimer=setInterval(()=>{this.tick();if(!this.timer)this.pump()},250)}this.pump(!continuous)}
  tick(){
    const now=this.now();if(this.running&&this.lastTick!==null&&this.game.phase==='social')this.game.discussionRemainingMs=Math.max(0,this.game.discussionRemainingMs-(now-this.lastTick));
    this.lastTick=now;this.onClock(this.game.frame());
  }
  requestVote(){if(this.game.phase==='social'){this.game.discussionRemainingMs=0;this.closeDiscussion();this.onClock(this.game.frame());this.pump()}}
  closeDiscussion(){if(this.game.phase==='social'&&this.game.discussionRemainingMs<=0&&!this.jobs.size){this.game.beginVote();this.waiting.clear();this.onClock(this.game.frame())}}
  pause(){if(this.running)this.tick();this.running=false;clearTimeout(this.timer);this.timer=null;clearInterval(this.clockTimer);this.clockTimer=null;this.lastTick=null;}
  stop(){this.pause();this.generation++;this.jobs.clear();this.onBusy([])}
  pump(single=false){
    if(!this.running&&!single)return;
    const g=this.game;
    this.closeDiscussion();
    if(g.phase==='social'&&g.discussionRemainingMs<=0)return;
    if(g.done){if(!this.jobs.size&&!this.finished){this.finished=true;this.pause();this.onDone(g.frame())}return}
    // Voting starts after every last social exchange and its assessments finish.
    if(g.phase==='vote'&&[...this.jobs.values()].some(j=>j.phase==='social'))return;
    const candidates=(g.phase==='vote'?g.voters:g.remaining).filter(id=>g.legalActions(id).length).sort((a,b)=>g.actionCounts[a]-g.actionCounts[b]||a-b);
    for(const actor of candidates){
      if(this.jobs.has(actor))continue;
      const waiting=this.waiting.get(actor);
      if(waiting&&this.now()<waiting.until&&context(g.observe(actor))===waiting.context)continue;
      this.waiting.delete(actor);
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
      if(context(this.game.observe(job.actor))!==context(observation))return;
      const result=this.game.step(action,'llm',job.actor);
      if(this.game.cycle!==this.cycle){this.cycle=this.game.cycle;this.waiting.clear();this.lastTick=this.now()}
      if(action.type==='pass')this.waiting.set(job.actor,{until:this.now()+this.waitMs,context:context(this.game.observe(job.actor))});
      this.onEvent(result);
      if(result.event.type==='say')await this.assess(result);
    }catch(error){if(active()){this.stop();this.onError(error)}}
    finally{
      if(active()){
        this.jobs.delete(job.actor);this.closeDiscussion();this.onBusy([...this.jobs.keys()]);
        if(this.game.done&&!this.jobs.size&&!this.finished){this.finished=true;this.pause();this.onDone(this.game.frame())}
        else if(this.running){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.pump()},this.delay())}
      }
    }
  }
}
