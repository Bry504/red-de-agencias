'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type FormState = {
  nombre_completo: string;
  celular: string;
  proyecto_interes: string;
  comentarios: string;
};

const initialState: FormState = {
  nombre_completo: '',
  celular: '',
  proyecto_interes: '',
  comentarios: '',
};

export default function EntornoPersonalClient() {
  const [form, setForm] = useState<FormState>(initialState);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [latitud, setLatitud] = useState<number | null>(null);
  const [longitud, setLongitud] = useState<number | null>(null);

  // uuid del usuario (usuarios.id) que viene en ?t=...
  const searchParams = useSearchParams();
  const token = searchParams.get('t');

  // Obtener geolocalización (si el usuario acepta)
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      console.warn('[EntornoPersonal] Geolocalización no disponible en este navegador');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitud(pos.coords.latitude);
        setLongitud(pos.coords.longitude);
      },
      (err) => {
        console.warn('[EntornoPersonal] Error obteniendo geolocalización:', err);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch('/api/tradicional/entorno-personal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          token,          // uuid de usuarios.id
          latitud,
          longitud,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(
          data?.error ??
            'No se pudo registrar el entorno personal. Intenta nuevamente.'
        );
      } else {
        setMessage('Registro guardado correctamente ✅');
        setForm(initialState);
      }
    } catch (err) {
      console.error(err);
      setError('Ocurrió un error inesperado. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-start bg-[#fde9d9] px-4 pt-6 pb-10"
      style={{ fontFamily: '"Times New Roman", Times, serif' }}
    >
      {/* Títulos fuera del cuadro, igual que el formulario de campo */}
      <div className="text-center mb-4">
        <h1 className="text-3xl sm:text-4xl font-bold text-[#d4551f]">
          REALTY GRUPO INMOBILIARIO
        </h1>
        <h2 className="text-lg sm:text-xl mt-1 text-[#b1451b]">
          Registro de entorno personal
        </h2>
      </div>

      {/* Cuadro blanco del formulario */}
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg p-6 sm:p-8 my-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nombre completo (obligatorio) */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Nombre completo <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              name="nombre_completo"
              value={form.nombre_completo}
              onChange={handleChange}
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Ej: Juan Pérez"
            />
          </div>

          {/* Celular (opcional) */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Celular (opcional)
            </label>
            <input
              type="tel"
              name="celular"
              value={form.celular}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="9 dígitos"
            />
          </div>

          {/* Proyecto de interés (opcional) */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Proyecto de interés (opcional)
            </label>
            <select
              name="proyecto_interes"
              value={form.proyecto_interes}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            >
              <option value="">Selecciona un proyecto</option>
              <option value="Bosques de Calango">Bosques de Calango</option>
              <option value="Asia Pacific Condominio">Asia Pacific Condominio</option>
              <option value="Pachacamac Luxury">Pachacamac Luxury</option>
              <option value="Paracas Realty Beach">Paracas Realty Beach</option>
              <option value="Toscana Garden">Toscana Garden</option>
              <option value="Buonavista">Buonavista</option>
              <option value="Altavista">Altavista</option>
            </select>
          </div>

          {/* Comentarios */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Comentarios / contexto
            </label>
            <textarea
              name="comentarios"
              value={form.comentarios}
              onChange={handleChange}
              rows={4}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Ej: Amigo del trabajo, está buscando invertir en un lote a mediano plazo..."
            />
          </div>

          {error && <p className="text-red-600">{error}</p>}
          {message && <p className="text-green-600">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#d4551f] hover:bg-[#b1451b] text-white font-semibold py-2 rounded-md disabled:opacity-60"
          >
            {loading ? 'Guardando...' : 'Registrar entorno personal'}
          </button>
        </form>
      </div>
    </main>
  );
}