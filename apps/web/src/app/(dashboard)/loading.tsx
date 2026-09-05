export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando">
      <div>
        <div className="skeleton mb-2 h-3 w-24" />
        <div className="skeleton h-7 w-56" />
      </div>
      <div className="card-surface h-40 p-5">
        <div className="skeleton mb-3 h-4 w-40" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton mt-2 h-3 w-5/6" />
      </div>
      <div className="card-surface h-40 p-5">
        <div className="skeleton mb-3 h-4 w-32" />
        <div className="skeleton h-3 w-3/4" />
      </div>
    </div>
  );
}
