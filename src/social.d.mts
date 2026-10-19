export interface Action { type:string; target?:number; group?:number; text?:string; intention?:string; reason?:string }
export interface Event { turn:number;cycle:number;round:number;type:string;actor:number;group:number|null;audience:number[];text:string;source:string }
export interface Group { id:number;members:number[];invited:number[];blocked:number[];proposals:{target:number;yes:number[];no:number[];needed:number}[];requests:{agent:number;yes:number[]}[] }
export interface Observation {version:string;agent:number;name:string;cycle:number;round:number;rounds:number;phase:string;remaining:{id:number;name:string}[];groups:{id:number;members:number[]}[];invitations:number[];exclusionProposals:Group['proposals'];joinRequests:Group['requests'];heard:{turn:number;text:string}[];intention:string;eliminated:number[];legal:Action[]}
export interface SocialFrame {version:string;seed:number;turn:number;cycle:number;round:number;rounds:number;phase:string;current:number|null;alive:boolean[];groups:Group[];summaries:string[];statuses:string[];events:Event[];councils:{number:number;eliminated:number;tied:boolean;ballots:{voter:number;target:number;reason:string;source:string}[]}[];winner:number|null;rewards:number[]}
export const SOCIAL_VERSION:string;
export const PEOPLE:string[];
export class SocialGame {
 constructor(options?:{seed?:number;rounds?:number}); seed:number;rounds:number;turn:number;cycle:number;round:number;phase:string;current:number|null;done:boolean;winner:number|null;remaining:number[];
 reset():SocialFrame;frame():SocialFrame;observe(agent?:number):Observation;legalActions(agent?:number):Action[];setSummary(agent:number,text:string):void;
 step(action:Action,source?:string):{event:Event;listeners:number[];frame:SocialFrame};
}
