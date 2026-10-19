/** social-v1: conversations by consent, private audiences, then mandatory voting. */
export const SOCIAL_VERSION = 'social-v1';
export const PEOPLE = ['Maya','Theo','Nia','Leo','Ava','Sam','Iris','Kai'];
const copy = value => structuredClone(value);
const brief = value => typeof value === 'string' ? value.trim().slice(0,180) : '';

export class SocialGame {
  constructor({seed=0,rounds=4}={}) {
    if (!Number.isInteger(seed) || !Number.isInteger(rounds) || rounds<1 || rounds>12) throw new RangeError('Invalid social game options');
    this.seed=seed; this.rounds=rounds; this.reset();
  }
  reset() {
    this.alive=PEOPLE.map(()=>true); this.groups=[]; this.nextGroup=1;
    this.turn=0; this.round=1; this.cycle=1; this.phase='social'; this.cursor=0;
    this.memories=PEOPLE.map(()=>[]); this.decisions=PEOPLE.map(()=>[]); this.intentions=PEOPLE.map(()=>[]); this.summaries=PEOPLE.map(()=> 'No conversation yet.');
    this.statuses=PEOPLE.map(()=> 'On their own'); this.events=[]; this.ballots=[]; this.councils=[];
    this.winner=null; this.rewards=PEOPLE.map(()=>0);
    return this.frame();
  }
  get remaining() { return this.alive.flatMap((v,i)=>v?[i]:[]); }
  get done() { return this.phase==='finished'; }
  get current() { return this.done ? null : this.remaining[this.cursor]; }
  groupOf(agent) { return this.groups.find(g=>g.members.includes(agent)); }
  observe(agent=this.current) {
    if (!Number.isInteger(agent) || !this.alive[agent]) throw new RangeError('Inactive agent');
    const group=this.groupOf(agent);
    return {
      version:SOCIAL_VERSION, agent, name:PEOPLE[agent], cycle:this.cycle, round:this.round, rounds:this.rounds, phase:this.phase,
      remaining:this.remaining.map(id=>({id,name:PEOPLE[id]})),
      // Membership is visible; outsiders never get conversation contents/proposals.
      groups:this.groups.map(g=>({id:g.id,members:g.members.slice()})),
      invitations:this.groups.filter(g=>g.invited.includes(agent)).map(g=>g.id),
      exclusionProposals:group ? copy(group.proposals) : [],
      joinRequests:group ? copy(group.requests) : [],
      heard:copy(this.memories[agent]), ownDecisions:copy(this.decisions[agent]), intentions:copy(this.intentions[agent]), intention:this.summaries[agent],
      eliminated:this.councils.map(c=>c.eliminated), legal:this.legalActions(agent),
    };
  }
  legalActions(agent=this.current) {
    if (!this.alive[agent] || this.done) return [];
    if (this.phase==='vote') return this.remaining.filter(i=>i!==agent).map(target=>({type:'vote',target}));
    const actions=[{type:'pass'}], group=this.groupOf(agent);
    if (group) {
      actions.push({type:'leave'});
      for(const request of group.requests)if(!request.yes.includes(agent))actions.push({type:'admit',target:request.agent},{type:'deny',target:request.agent});
      if(group.members.length>1)actions.push({type:'say'});
      if(group.members.length>=3) for(const target of group.members.filter(i=>i!==agent)) {
        const proposal=group.proposals.find(p=>p.target===target);
        if(!proposal)actions.push({type:'exclude',target});
        else if(!proposal.yes.includes(agent)&&!proposal.no.includes(agent))actions.push({type:'agree',target},{type:'reject',target});
      }
    } else {
      for(const g of this.groups.filter(g=>g.invited.includes(agent)))actions.push({type:'join',group:g.id},{type:'decline',group:g.id});
      for(const g of this.groups.filter(g=>!g.invited.includes(agent)&&!g.blocked.includes(agent)&&!g.requests.some(r=>r.agent===agent)))actions.push({type:'request',group:g.id});
    }
    for(const target of this.remaining.filter(i=>i!==agent && !this.groupOf(i))) {
      if(!group || (!group.invited.includes(target)&&!group.blocked.includes(target)))actions.push({type:'invite',target});
    }
    return actions;
  }
  remember(audience,text) {
    for(const id of audience) this.memories[id].push({turn:this.turn,cycle:this.cycle,round:this.round,text});
  }
  removeMember(group,agent) {
    group.members=group.members.filter(i=>i!==agent);
    // Membership changes invalidate pending exclusion votes; thresholds never drift.
    group.proposals=[];group.requests=[];
    if(!group.members.length)this.groups=this.groups.filter(g=>g!==group);
  }
  setSummary(agent,text) { if(this.alive[agent] && brief(text)){this.summaries[agent]=brief(text);this.intentions[agent].push({turn:this.turn,cycle:this.cycle,text:brief(text)});} }
  step(action,source='scripted') {
    if(this.done)throw new Error('Game finished');
    const actor=this.current;
    const chosen=this.legalActions(actor).find(a=>a.type===action?.type && a.target===action.target && a.group===action.group);
    if(!chosen || (chosen.type==='say'&&!brief(action.text)))throw new RangeError('Illegal social action');
    if(!['scripted','llm','fallback','agent'].includes(source))throw new RangeError('Unknown action source');
    let group=this.groupOf(actor), audience=[actor], text='', listeners=[];
    const name=PEOPLE[actor], target=chosen.target;
    this.turn++;
    this.setSummary(actor,action.intention);
    this.decisions[actor].push({turn:this.turn,cycle:this.cycle,round:this.round,action:{...chosen,...(chosen.type==='say'?{text:brief(action.text)}:{}),...(chosen.type==='vote'?{reason:brief(action.reason)}:{})},source});
    switch(chosen.type) {
      case 'invite':
        if(!group){group={id:this.nextGroup++,members:[actor],invited:[],blocked:[],proposals:[],requests:[]};this.groups.push(group);}
        group.invited.push(target); audience=[...group.members,target];
        text=`${name} invites ${PEOPLE[target]} to conversation ${group.id}.`;
        this.statuses[actor]='Inviting someone';break;
      case 'join':
        group=this.groups.find(g=>g.id===chosen.group);group.members.push(actor);group.proposals=[];group.requests=[];
        for(const g of this.groups){g.invited=g.invited.filter(i=>i!==actor);g.requests=g.requests.filter(r=>r.agent!==actor);}
        audience=group.members.slice();text=`${name} accepts the invitation.`;this.statuses[actor]='Joined the conversation';break;
      case 'request':
        group=this.groups.find(g=>g.id===chosen.group);group.requests.push({agent:actor,yes:[]});
        audience=[actor,...group.members];text=`${name} asks to join conversation ${group.id}.`;this.statuses[actor]='Asked to join';break;
      case 'admit': case 'deny': {
        const request=group.requests.find(r=>r.agent===target);audience=[...group.members,target];
        if(chosen.type==='deny'){
          group.requests=group.requests.filter(r=>r!==request);text=`${name} declines ${PEOPLE[target]}'s request to join.`;
        }else{
          request.yes.push(actor);text=`${name} supports admitting ${PEOPLE[target]}.`;
          if(group.members.every(id=>request.yes.includes(id))){
            group.members.push(target);group.proposals=[];group.requests=[];
            for(const g of this.groups){g.invited=g.invited.filter(i=>i!==target);g.requests=g.requests.filter(r=>r.agent!==target);}
            text+=` Everyone agrees; ${PEOPLE[target]} joins.`;this.statuses[target]='Request accepted';
          }
        }
        this.statuses[actor]='Answered a join request';break;
      }
      case 'decline':
        group=this.groups.find(g=>g.id===chosen.group);group.invited=group.invited.filter(i=>i!==actor);
        audience=[actor,...group.members];text=`${name} declines the invitation.`;this.statuses[actor]='Declined an invitation';break;
      case 'leave':
        audience=group.members.slice();text=`${name} leaves the conversation.`;this.removeMember(group,actor);this.statuses[actor]='Chose to leave';break;
      case 'say':
        audience=group.members.slice();listeners=audience.filter(i=>i!==actor);
        text=brief(action.text);this.statuses[actor]='Speaking';break;
      case 'exclude':
        group.proposals.push({target,yes:[actor],no:[],needed:Math.max(2,Math.floor((group.members.length-1)/2)+1)});
        audience=group.members.slice();text=`${name} proposes asking ${PEOPLE[target]} to leave.`;this.statuses[actor]='Proposed an exclusion';break;
      case 'agree': case 'reject': {
        const proposal=group.proposals.find(p=>p.target===target);
        proposal[chosen.type==='agree'?'yes':'no'].push(actor);audience=group.members.slice();
        text=`${name} ${chosen.type==='agree'?'supports':'opposes'} excluding ${PEOPLE[target]}.`;
        if(proposal.yes.length>=proposal.needed){
          text+=` The group excludes ${PEOPLE[target]}.`;group.blocked.push(target);this.removeMember(group,target);this.statuses[target]='Excluded from the conversation';
        } else if(proposal.no.length>group.members.length-1-proposal.needed)group.proposals=group.proposals.filter(p=>p!==proposal);
        this.statuses[actor]='Responded to the group';break;
      }
      case 'pass':text=`${name} chooses not to participate this turn.`;this.statuses[actor]='Sitting this turn out';break;
      case 'vote':
        this.ballots.push({voter:actor,target,reason:brief(action.reason)||'No reason given.',source});
        text=`${name} casts a private ballot.`;this.statuses[actor]='Voted';break;
    }
    this.remember(audience,chosen.type==='say'?`${name}: ${text}`:text);
    const event={turn:this.turn,cycle:this.cycle,round:this.round,type:chosen.type,actor,group:group?.id??null,audience:audience.slice(),text,source};
    this.events.push(event);
    this.cursor++;
    if(this.cursor>=this.remaining.length){
      this.cursor=0;
      if(this.phase==='social') {if(this.round===this.rounds)this.phase='vote';else this.round++;}
      else this.finishVote();
    }
    return {event:copy(event),listeners,frame:this.frame()};
  }
  finishVote() {
    const counts=this.remaining.map(id=>({id,count:this.ballots.filter(v=>v.target===id).length}));
    const high=Math.max(...counts.map(c=>c.count)),tied=counts.filter(c=>c.count===high).map(c=>c.id);
    const eliminated=tied[((this.seed>>>0)+this.cycle*53)%tied.length];
    this.councils.push({number:this.cycle,eliminated,tied:tied.length>1,ballots:copy(this.ballots)});
    this.alive[eliminated]=false;this.statuses[eliminated]='Voted out';this.groups=[];this.ballots=[];this.round=1;
    this.remember(this.remaining,`${PEOPLE[eliminated]} was voted out.`);
    if(this.remaining.length===1){this.phase='finished';this.winner=this.remaining[0];this.rewards[this.winner]=1;}
    else{this.phase='social';this.cycle++;}
  }
  frame() {
    return copy({version:SOCIAL_VERSION,seed:this.seed,turn:this.turn,cycle:this.cycle,round:this.round,rounds:this.rounds,
      phase:this.phase,current:this.current,alive:this.alive,groups:this.groups,summaries:this.summaries,statuses:this.statuses,
      events:this.events,councils:this.councils,winner:this.winner,rewards:this.rewards});
  }
}
