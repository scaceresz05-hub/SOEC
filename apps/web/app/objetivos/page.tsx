import { redirect } from 'next/navigation';
// Unificado en el panel del negocio (UX-2): esta sección vive ahora como pestaña de /negocios.
export default function Page(): never {
  redirect('/negocios');
}
