import { Link } from 'react-router-dom';
import { ar } from '../i18n/ar';
export default function UnauthorizedPage() { return <main className="grid min-h-screen place-items-center p-6 text-center"><section><div className="mb-3 text-5xl">🔒</div><h1 className="text-2xl font-bold">{ar.unauthorizedTitle}</h1><p className="mt-2 text-slate-400">{ar.unauthorizedDescription}</p><Link to="/" className="button-primary mt-6 inline-flex">{ar.backHome}</Link></section></main>; }
