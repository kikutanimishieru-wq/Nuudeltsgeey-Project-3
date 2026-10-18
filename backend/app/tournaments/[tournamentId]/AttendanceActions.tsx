'use client';
import { useEffect,useState,type FormEvent } from 'react';
type Attendance={checkedInAt:string|null;pendingRequest:{id:string;status:string}|null};
export default function AttendanceActions({tournamentId}:{tournamentId:string}) {
  const [attendance,setAttendance]=useState<Attendance|null>(null);
  const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  const base=`/api/tournaments/${encodeURIComponent(tournamentId)}`;
  async function refresh() {
    const response=await fetch(`${base}/attendance`,{cache:'no-store'});
    if(response.ok)setAttendance(await response.json());
  }
  useEffect(()=>{refresh().catch(()=>{});},[tournamentId]); // Server authorizes every action independently.
  async function post(path:string,body:unknown) {
    const response=await fetch(`${base}/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) {
      const messages:Record<string,string>={
        UNAUTHORIZED:'Sign in before confirming attendance.',
        COMPETITIVE_IDENTITY_REQUIRED:'Complete Steam and Discord verification before checking in.',
        REGISTRATION_NOT_FOUND:'You are not registered in an active tournament roster.',
        CHECK_IN_WINDOW_CLOSED:'Ordinary check-in opens 15 minutes before the scheduled start.',
        FLOOR_2_REQUIRED:'Protected late arrival is available only to eligible Floor 2 players.',
        PERSONAL_LATENESS_REQUEST_REQUIRED:'Submit your personal late-arrival reason, then complete Check In.',
        PROTECTED_CHECK_IN_DEADLINE_PASSED:'The protected check-in deadline has passed.',
        LATENESS_REQUEST_ALREADY_PENDING:'You already have a pending request. Refresh your attendance before checking in.',
        LATENESS_HAS_NOT_STARTED:'Late-arrival requests open at the scheduled start.',
        PLAYER_ALREADY_CHECKED_IN:'Your attendance is already confirmed.',
        TOURNAMENT_ROSTER_LOCKED:'Tournament rosters are locked.',
        INVALID_INPUT:'Check your request details and provide a non-empty reason.',
      };
      throw new Error(messages[data.error] ?? 'This action is unavailable. Refresh your attendance and try again.');
    }
    return data;
  }
  async function checkIn() {
    setBusy(true);setMessage('');
    try {
      const request=attendance?.pendingRequest;
      await post('check-in',request?.status==='REQUESTED'?{latenessRequestId:request.id}:{});
      setMessage('Your attendance is confirmed.');await refresh();
    } catch(error){setMessage(error instanceof Error?error.message:'Attendance could not be recorded.');await refresh().catch(()=>{});}
    finally{setBusy(false);}
  }
  async function requestLateness(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setMessage('');
    const reason=new FormData(event.currentTarget).get('reason');
    try {await post('lateness',{reason});await refresh();setMessage('Request recorded. Complete your own Check In by the protected deadline.');}
    catch(error){setMessage(error instanceof Error?error.message:'Request could not be recorded.');}
    finally{setBusy(false);}
  }
  return <section className="public-panel"><h2>Your attendance</h2><p>Registered players check in personally from 15 minutes before start until start. This confirms your attendance; it does not independently verify physical presence.</p>
    {attendance?.checkedInAt ? <p>Checked in: {new Date(attendance.checkedInAt).toISOString()}</p> : <>
      <button className="public-link" disabled={busy} onClick={checkIn}>Check In</button>
      <form onSubmit={requestLateness}><p>Eligible Floor 2 players may request their one protected late arrival and complete Check In no later than 15 minutes after start.</p><label>Reason <input name="reason" required maxLength={1000}/></label> <button className="public-link" disabled={busy || attendance?.pendingRequest?.status==='REQUESTED'}>Request late arrival</button></form>
    </>}
    {attendance?.pendingRequest && <p>Late-arrival request: {attendance.pendingRequest.status}</p>}
    <p role="status">{message}</p><p><a className="public-link" href="/identity">Sign in and manage verified identity</a></p>
  </section>;
}
