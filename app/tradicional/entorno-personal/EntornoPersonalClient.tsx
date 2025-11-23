'use client';

import { useState } from 'react';

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
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? 'No se pudo registrar el entorno personal.');
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Nombre completo (obligatorio) */}
      <div>
        <label className="block font-semibold mb-1">
          Nombre completo <span className="text-red-600">*</span>
        </label>
        <input
          type="text"
          name="nombre_completo"
          value={form.nombre_completo}
          onChange={handleChange}
          required
          className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#b74b1e]"
          placeholder="Ej: Juan Pérez"
        />
      </div>

      {/* Celular (opcional) */}
      <div>
        <label className="block font-semibold mb-1">
          Celular (opcional)
        </label>
        <input
          type="tel"
          name="celular"
          value={form.celular}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#b74b1e]"
          placeholder="9 dígitos"
        />
      </div>

      {/* Proyecto de interés (opcional) */}
      <div>
        <label className="block font-semibold mb-1">
          Proyecto de interés (opcional)
        </label>
        <select
          name="proyecto_interes"
          value={form.proyecto_interes}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#b74b1e]"
        >
          <option value="">Selecciona un proyecto</option>
          {/* Usa las mismas opciones del otro formulario */}
          <option value="Toscana Garden">Toscana Garden</option>
          <option value="Mala - Bujama Alta">Mala - Bujama Alta</option>
          <option value="Departamentos Lima">Departamentos Lima</option>
          {/* agrega aquí las que ya tengas */}
        </select>
      </div>

      {/* Comentarios (irá a notas) */}
      <div>
        <label className="block font-semibold mb-1">
          Comentarios / contexto
        </label>
        <textarea
          name="comentarios"
          value={form.comentarios}
          onChange={handleChange}
          rows={4}
          className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#b74b1e]"
          placeholder="Ej: Amigo del trabajo, está buscando invertir en un lote a mediano plazo..."
        />
      </div>

      {/* Mensajes */}
      {message && (
        <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {message}
        </p>
      )}
      {error && (
        <p className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#b74b1e] text-white font-semibold py-2 rounded-lg shadow hover:bg-[#a14119] disabled:opacity-60"
      >
        {loading ? 'Guardando...' : 'Registrar entorno personal'}
      </button>
    </form>
  );
}