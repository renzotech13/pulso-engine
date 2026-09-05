export default function StatsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando estadísticas">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="skeleton mb-2 h-3 w-24" />
          <div className="skeleton h-7 w-40" />
          <div className="skeleton mt-2 h-3 w-72 max-w-full" />
        </div>
        <div className="skeleton h-9 w-56" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card-surface p-4">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-2 h-8 w-16" />
            <div className="skeleton mt-2 h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="card-surface p-5">
            <div className="skeleton mb-4 h-4 w-44" />
            <div className="skeleton h-60 w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="card-surface p-5">
            <div className="skeleton mb-4 h-4 w-32" />
            <div className="skeleton h-32 w-full" />
          </div>
        ))}
      </div>

      <div className="card-surface p-5">
        <div className="skeleton mb-4 h-4 w-24" />
        <div className="skeleton h-60 w-full" />
      </div>
    </div>
  );
}
