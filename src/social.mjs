/** social-v1: conversations by consent, private audiences, then mandatory voting. */
export const SOCIAL_VERSION = 'social-v1';
export const PEOPLE = ['Maya','Theo','Nia','Leo','Ava','Sam','Iris','Kai'];
const copy = value => structuredClone(value);
const brief = value => typeof value === 'string' ? value.trim().slice(0,180) : '';

export class SocialGame {
  constructor({seed=0,rounds=4,concurrent=false,discussionSeconds=120}={}) {
    if (!Number.isInteger(seed) || !Number.isInteger(rounds) || rounds<1 || rounds>12) throw new RangeError('Invalid social game options');
    if(!Number.isFinite(discussionSeconds)||discussionSeconds<=0)throw new RangeError('Invalid discussion duration');
    this.discussionSeconds=discussionSeconds;this.discussionRemainingMs=discussionSeconds*1000;this.seed=seed; this.rounds=rounds; this.concurrent=concurrent; this.reset();
  }
  reset() {
    this.discussionRemainingMs=this.discussionSeconds*1000;this.alive=PEOPLE.map(()=>true); this.groups=[]; this.nextGroup=1;
    this.actionCounts=PEOPLE.map(()=>0);this.discussionCounts=PEOPLE.map(()=>0);this.managementCounts=PEOPLE.map(()=>0); this.turn=0; this.round=1; this.cycle=1; this.phase='social'; this.cursor=0;
    this.socialHistory=PEOPLE.map(()=>[]); this.knownGroups=PEOPLE.map(()=>new Set()); this.memories=PEOPLE.map(()=>[]); this.decisions=PEOPLE.map(()=>[]); this.intentions=PEOPLE.map(()=>[]); this.summaries=PEOPLE.map(()=> 'No conversation yet.');
    this.statuses=PEOPLE.map(()=> 'On their own'); this.events=[]; this.ballots=[]; this.councils=[];
    this.winner=null; this.rewards=PEOPLE.map(()=>0);
    return this.frame();
  }
  get remaining() { return this.alive.flatMap((v,i)=>v?[i]:[]); }
  get voters() { return this.remaining.length===3 ? this.alive.flatMap((v,i)=>v?[]:[i]) : this.remaining; }
  get done() { return this.phase==='finished'; }
  get current() { return this.done ? null : this.concurrent ? ((this.phase==='vote'?this.voters:this.remaining).find(id=>this.phase==='vote'?!this.ballots.some(b=>b.voter===id):true)??null) : (this.phase==='vote'?this.voters:this.remaining)[this.cursor]; }
  groupOf(agent) { return this.groups.find(g=>g.members.includes(agent)); }
  observe(agent=this.current) {
    if (!Number.isInteger(agent) || (!this.alive[agent] && !(this.phase==='vote'&&this.voters.includes(agent)))) throw new RangeError('Inactive agent');
    const group=this.groupOf(agent);
    return {
      version:SOCIAL_VERSION, agent, name:PEOPLE[agent], cycle:this.cycle, round:this.concurrent&&this.phase==='social'?Math.min(this.rounds,this.discussionCounts[agent]+1):this.round, rounds:this.rounds, phase:this.phase,
      ...(this.concurrent?{voteClock:{secondsRemaining:Math.ceil(this.discussionRemainingMs/1000),discussionSeconds:this.discussionSeconds,rule:'You may act throughout discussion. Passing means waiting briefly, not opting out. When the shared active-play clock reaches zero, pending replies finish and everyone votes.'}}:{}),
      votePurpose:this.remaining.length===3?'choose_winner':'eliminate',
      votingRule:this.remaining.length===3?'The five eliminated players form the jury. Each votes for one of the final three to WIN. Finalists do not vote. Use only your own retained memories; other private conversations remain hidden.':'Vote to eliminate another remaining player.',
      remaining:this.remaining.map(id=>({id,name:PEOPLE[id]})),
      // Only current own membership is visible; other groups must be encountered or reported.
      groups:group && group.members.length>1 ? [{id:group.id,members:group.members.slice()}] : [],
      pendingInvitations:group && group.members.length===1 ? [{id:group.id,invited:group.invited.slice()}] : [],
      knownConversations:[...this.knownGroups[agent]], socialHistory:copy(this.socialHistory[agent]),
      invitations:this.groups.filter(g=>g.invited.includes(agent)).map(g=>g.id),
      exclusionProposals:group ? copy(group.proposals) : [],
      joinRequests:group ? copy(group.requests) : [],
      heard:copy(this.memories[agent]), ownDecisions:copy(this.decisions[agent]), intentions:copy(this.intentions[agent]), intention:this.summaries[agent],
      eliminated:this.councils.filter(c=>c.eliminated!==null).map(c=>c.eliminated), legal:this.legalActions(agent),
    };
  }
  legalActions(agent=this.current) {
    if(this.done)return [];
    if(this.phase==='vote'&&this.remaining.length===3)return this.voters.includes(agent)&&!this.ballots.some(b=>b.voter===agent)?this.remaining.map(target=>({type:'vote',target})):[];
    if (!this.alive[agent]) return [];
    if(this.concurrent&&this.phase==='vote'&&this.ballots.some(b=>b.voter===agent))return [];
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
    }
    if(!group||group.members.length===1){
      for(const g of this.groups.filter(g=>g!==group&&g.invited.includes(agent)))actions.push({type:'join',group:g.id},{type:'decline',group:g.id});
      for(const g of this.groups.filter(g=>g!==group&&this.knownGroups[agent].has(g.id)&&!g.invited.includes(agent)&&!g.blocked.includes(agent)&&!g.requests.some(r=>r.agent===agent)))actions.push({type:'request',group:g.id});
    }
    for(const target of this.remaining.filter(i=>i!==agent && !group?.members.includes(i))) {
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
    if(group.members.length===1)this.statuses[group.members[0]]=group.invited.length?'Waiting for an invitation reply':'On their own';
    if(!group.members.length)this.groups=this.groups.filter(g=>g!==group);
  }
  withdrawPending(agent,destination){
    const old=this.groupOf(agent);if(!old||old===destination)return;
    if(old.members.length>1)throw new RangeError('Leave existing conversation first');
    const recipients=[agent,...old.invited],text=`${PEOPLE[agent]} withdrew pending invitations for conversation ${old.id} to join another conversation.`;
    this.remember(recipients,text);
    for(const id of recipients)this.socialHistory[id].push({turn:this.turn,cycle:this.cycle,round:this.round,conversation:old.id,actor:agent,target:agent,type:'withdraw',outcome:'cancelled',text,evidence:'direct notification'});
    this.removeMember(old,agent);
  }
  setSummary(agent,text) { if(this.alive[agent] && brief(text)){this.summaries[agent]=brief(text);this.intentions[agent].push({turn:this.turn,cycle:this.cycle,text:brief(text)});} }
  step(action,source='scripted',actor=this.current) {
    if(this.done)throw new Error('Game finished');
    if(!this.concurrent&&actor!==this.current)throw new RangeError('Out-of-turn action');
    const chosen=this.legalActions(actor).find(a=>a.type===action?.type && a.target===action.target && a.group===action.group);
    if(!chosen || (chosen.type==='say'&&!brief(action.text)))throw new RangeError('Illegal social action');
    if(!['scripted','llm','fallback','agent'].includes(source))throw new RangeError('Unknown action source');
    let group=this.groupOf(actor), audience=[actor], text='', listeners=[];
    const name=PEOPLE[actor], target=chosen.target;
    const pendingRequests=this.groups.flatMap(g=>g.requests.map(r=>({conversation:g.id,agent:r.agent,members:g.members.slice()})));
    if(this.concurrent&&this.phase==='social')this.round=this.discussionCounts[actor]+1;
    this.turn++;
    this.setSummary(actor,action.intention);
    this.decisions[actor].push({turn:this.turn,cycle:this.cycle,round:this.round,action:{...chosen,...(chosen.type==='say'?{text:brief(action.text)}:{}),...(chosen.type==='vote'?{reason:brief(action.reason)}:{})},source});
    switch(chosen.type) {
      case 'invite':
        if(!group){group={id:this.nextGroup++,members:[actor],invited:[],blocked:[],proposals:[],requests:[]};this.groups.push(group);}
        group.invited.push(target); audience=[...group.members,target];
        text=`${name} invites ${PEOPLE[target]} to conversation ${group.id}.`;
        this.statuses[actor]=group.members.length===1?'Waiting for an invitation reply':'Inviting someone';break;
      case 'join':
        group=this.groups.find(g=>g.id===chosen.group);this.withdrawPending(actor,group);group.members.push(actor);group.proposals=[];group.requests=[];
        for(const g of this.groups){g.invited=g.invited.filter(i=>i!==actor);g.requests=g.requests.filter(r=>r.agent!==actor);}
        audience=group.members.slice();text=`${name} accepts the invitation to conversation ${group.id}.`;for(const id of group.members)this.statuses[id]='In a conversation';break;
      case 'request':
        group=this.groups.find(g=>g.id===chosen.group);group.requests.push({agent:actor,yes:[]});
        audience=[actor,...group.members];text=`${name} asks to join conversation ${group.id}.`;this.statuses[actor]='Asked to join';break;
      case 'admit': case 'deny': {
        const request=group.requests.find(r=>r.agent===target);audience=[...group.members,target];
        if(chosen.type==='deny'){
          group.requests=group.requests.filter(r=>r!==request);text=`${name} denies ${PEOPLE[target]}'s request to join conversation ${group.id}.`;
        }else{
          request.yes.push(actor);text=`${name} supports admitting ${PEOPLE[target]} to conversation ${group.id}.`;
          if(group.members.every(id=>request.yes.includes(id))){
            this.withdrawPending(target,group);group.members.push(target);group.proposals=[];group.requests=[];
            for(const g of this.groups){g.invited=g.invited.filter(i=>i!==target);g.requests=g.requests.filter(r=>r.agent!==target);}
            text+=` Accepted by ${request.yes.map(id=>PEOPLE[id]).join(', ')}; ${PEOPLE[target]} joins.`;for(const id of group.members)this.statuses[id]='In a conversation';
          }
        }
        this.statuses[actor]='Answered a join request';break;
      }
      case 'decline':
        group=this.groups.find(g=>g.id===chosen.group);group.invited=group.invited.filter(i=>i!==actor);
        if(group.members.length===1&&!group.invited.length)this.statuses[group.members[0]]='On their own';
        audience=[actor,...group.members];text=`${name} declines the invitation.`;this.statuses[actor]='Declined an invitation';break;
      case 'leave':
        audience=group.members.slice();text=group.members.length===1?`${name} cancels the pending conversation.`:`${name} leaves the conversation.`;this.removeMember(group,actor);this.statuses[actor]='Chose to leave';break;
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
      case 'pass':text=this.concurrent?`${name} chooses to wait for now.`:`${name} chooses not to participate this turn.`;this.statuses[actor]=this.concurrent?'Waiting — may act again':'Sitting this turn out';break;
      case 'vote':
        this.ballots.push({voter:actor,target,reason:brief(action.reason)||'No reason given.',source});
        text=`${name} casts a private ballot.`;this.statuses[actor]='Voted';break;
    }
    if(group)for(const id of audience)this.knownGroups[id].add(group.id);
    const outcome=chosen.type==='deny'?'denied':chosen.type==='admit'?(group.members.includes(target)?'accepted':'supported'):chosen.type==='join'?'accepted':chosen.type==='decline'?'declined':chosen.type==='request'?'pending':chosen.type;
    if(['invite','join','request','admit','deny','decline','leave','exclude','agree','reject'].includes(chosen.type)){
      const record={turn:this.turn,cycle:this.cycle,round:this.round,conversation:group?.id??null,actor,target:target??actor,type:chosen.type,outcome,text,evidence:'direct notification'};
      for(const id of audience)this.socialHistory[id].push(copy(record));
    }
    if(chosen.type==='say'){
      // Voluntary reports remain attributed speech, never verified social facts.
      for(const match of text.matchAll(/conversation\s+#?(\d+)/gi))for(const id of audience)this.knownGroups[id].add(Number(match[1]));
    }
    this.remember(audience,chosen.type==='say'?`${name}: ${text}`:text);
    const event={turn:this.turn,cycle:this.cycle,round:this.round,type:chosen.type,actor,group:group?.id??null,audience:audience.slice(),text,source};
    for(const request of pendingRequests){
      const stillPending=this.groups.some(g=>g.id===request.conversation&&g.requests.some(r=>r.agent===request.agent));
      const resolved=request.conversation===group?.id&&request.agent===target&&['admit','deny'].includes(chosen.type);
      if(!stillPending&&!resolved){
        const text=`Request by ${PEOPLE[request.agent]} to conversation ${request.conversation} was cancelled because membership changed; this was not a rejection.`;
        const recipients=[...new Set([...request.members,request.agent])];
        this.remember(recipients,text);
        for(const id of recipients)this.socialHistory[id].push({turn:this.turn,cycle:this.cycle,round:this.round,conversation:request.conversation,actor:null,target:request.agent,type:'cancel',outcome:'cancelled',text,evidence:'direct notification'});
      }
    }
    this.events.push(event);
    if(this.concurrent){
      if(this.phase==='social'){
        this.actionCounts[actor]++;
        if(['say','pass'].includes(chosen.type))this.discussionCounts[actor]++;
        else this.managementCounts[actor]++;
        this.round=Math.min(this.rounds,Math.min(...this.remaining.map(id=>this.discussionCounts[id]))+1);

      }else if(this.ballots.length===this.voters.length)this.finishVote();
    }else{
      this.cursor++;
      if(this.cursor>=(this.phase==='vote'?this.voters:this.remaining).length){
        this.cursor=0;
        if(this.phase==='social') {if(this.round===this.rounds)this.phase='vote';else this.round++;}
        else this.finishVote();
      }
    }
    return {event:copy(event),listeners,frame:this.frame()};
  }
  beginVote() {
    if(!this.concurrent||this.phase!=='social')throw new Error('No live discussion to close');
    this.discussionRemainingMs=0;this.phase='vote';return this.frame();
  }
  finishVote() {
    const counts=this.remaining.map(id=>({id,count:this.ballots.filter(v=>v.target===id).length}));
    const high=Math.max(...counts.map(c=>c.count)),tied=counts.filter(c=>c.count===high).map(c=>c.id);
    if(this.remaining.length===3){
      this.winner=tied[((this.seed>>>0)+this.cycle*53)%tied.length];this.rewards[this.winner]=1;
      this.councils.push({number:this.cycle,kind:'jury',winner:this.winner,eliminated:null,tied:tied.length>1,ballots:copy(this.ballots)});
      this.phase='finished';this.groups=[];this.ballots=[];
      for(const id of this.remaining)this.statuses[id]=id===this.winner?'Winner':'Finalist';
      this.remember(PEOPLE.map((_,id)=>id),`${PEOPLE[this.winner]} won the jury vote.`);return;
    }
    const eliminated=tied[((this.seed>>>0)+this.cycle*53)%tied.length];
    this.councils.push({number:this.cycle,eliminated,tied:tied.length>1,ballots:copy(this.ballots)});
    for(const group of this.groups)for(const request of group.requests){
      const text=`Request by ${PEOPLE[request.agent]} to conversation ${group.id} ended when voting closed the conversation; it was not denied.`;
      const recipients=[...new Set([...group.members,request.agent])];this.remember(recipients,text);
      for(const id of recipients)this.socialHistory[id].push({turn:this.turn,cycle:this.cycle,round:this.round,conversation:group.id,actor:null,target:request.agent,type:'cancel',outcome:'cancelled',text,evidence:'direct notification'});
    }
    this.alive[eliminated]=false;this.statuses[eliminated]='Voted out';this.groups=[];this.ballots=[];this.round=1;this.actionCounts=PEOPLE.map(()=>0);this.discussionCounts=PEOPLE.map(()=>0);this.managementCounts=PEOPLE.map(()=>0);
    this.remember(this.remaining,`${PEOPLE[eliminated]} was voted out.`);
    if(this.remaining.length===1){this.phase='finished';this.winner=this.remaining[0];this.rewards[this.winner]=1;}
    else{this.phase='social';this.cycle++;this.discussionRemainingMs=this.discussionSeconds*1000;}
  }
  frame() {
    return copy({version:SOCIAL_VERSION,seed:this.seed,discussionRemainingMs:this.discussionRemainingMs,discussionSeconds:this.discussionSeconds,concurrent:this.concurrent,actionCounts:this.actionCounts,discussionCounts:this.discussionCounts,managementCounts:this.managementCounts,turn:this.turn,cycle:this.cycle,round:this.round,rounds:this.rounds,
      phase:this.phase,current:this.current,alive:this.alive,groups:this.groups.filter(g=>g.members.length>1),pendingConversations:this.groups.filter(g=>g.members.length===1),summaries:this.summaries,statuses:this.statuses,
      events:this.events,councils:this.councils,winner:this.winner,rewards:this.rewards});
  }
}
