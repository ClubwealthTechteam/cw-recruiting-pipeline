import { redirect } from 'next/navigation';
import { USERS, setupProblem, userForCode, startSession, currentUser, isLocked, recordFailure, clearFailures } from '@/lib/auth';

async function login(formData: FormData) {
  'use server';
  const name = String(formData.get('name') || '');
  const code = String(formData.get('code') || '');
  if (setupProblem()) redirect('/login?e=setup');
  if (isLocked(name)) redirect('/login?e=locked');
  const user = userForCode(name, code);
  if (!user) {
    recordFailure(name);
    redirect('/login?e=wrong');
  }
  clearFailures(name);
  await startSession(user);
  redirect('/');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await currentUser()) redirect('/');
  const { e } = await searchParams;
  const problem = setupProblem();
  return (
    <main className="login">
      <form action={login} className="login-card">
        <div className="brand">Club Wealth</div>
        <h1>Recruiting Pipeline</h1>
        <label>
          Name
          <select name="name" required defaultValue="">
            <option value="" disabled>Select your name</option>
            {USERS.map((u) => <option key={u} value={u}>{u === 'Am' ? 'Am Marbella' : u}</option>)}
          </select>
        </label>
        <label>
          Access code
          <input name="code" type="password" autoComplete="off" placeholder="CW-XXXX-XXXX" required />
        </label>
        {e === 'wrong' && <p className="error">That code is not correct.</p>}
        {problem && <p className="error">Setup problem: {problem}</p>}
        {e === 'locked' && <p className="error">Too many attempts. Try again in 15 minutes.</p>}
        <button type="submit" className="btn primary">Sign in</button>
      </form>
    </main>
  );
}
