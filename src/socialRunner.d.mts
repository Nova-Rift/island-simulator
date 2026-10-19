import type {SocialGame,Observation,Action,SocialFrame,Event} from './social.mjs'
export class SocialRunner {
 constructor(options:{game:SocialGame;decide:(o:Observation)=>Promise<Action>;assess?:(result:{event:Event;listeners:number[];frame:SocialFrame})=>Promise<void>;onEvent?:(result:{event:Event;listeners:number[];frame:SocialFrame})=>void;onBusy?:(actors:number[])=>void;onError?:(error:unknown)=>void;onDone?:(frame:SocialFrame)=>void;delay?:()=>number});start(continuous?:boolean):void;pause():void;stop():void;
}
