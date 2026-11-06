import { Link, useLocation } from 'react-router-dom';
import { Package, ShoppingCart, BarChart3, Construction } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { ar } from '../i18n/ar';

export default function ComingSoonPage() {
  const location = useLocation();
  const config = location.pathname === '/products'
    ? { title: ar.productsTitle, description: ar.phaseReady, Icon: Package }
    : location.pathname === '/pos'
      ? { title: ar.posTitle, description: ar.cartEmptyDesc, Icon: ShoppingCart }
      : { title: ar.reportsTitle, description: ar.phaseReady, Icon: BarChart3 };
  const Icon = config.Icon;
  return (
    <div className="space-y-4" dir="rtl">
      <h2 className="text-xl font-extrabold text-white">{config.title}</h2>
      <Card className="py-10 text-center">
        <Icon className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
        <Construction className="mx-auto mb-3 h-5 w-5 text-amber-400" />
        <p className="text-sm text-slate-300">{config.description}</p>
        <p className="mt-2 text-xs text-slate-500">{ar.comingSoonDescription}</p>
        <Link className="button-secondary mt-5 inline-flex items-center" to="/">{ar.backHome}</Link>
      </Card>
    </div>
  );
}
