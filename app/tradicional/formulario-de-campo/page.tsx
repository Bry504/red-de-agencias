// app/tradicional/formulario-de-campo/page.tsx

import FormularioDeCampoClient from './FormularioDeCampoClient';

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

export default function Page({ searchParams }: Props) {
  const t = searchParams.t;
  const usuarioId = Array.isArray(t) ? t[0] : t ?? null;

  return <FormularioDeCampoClient usuarioId={usuarioId} />;
}