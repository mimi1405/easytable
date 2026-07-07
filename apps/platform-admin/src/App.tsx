import { useSession, signOut } from "@easytable/auth";
import { Login } from "@easytable/ui/pages/login/Login";
import { AppLayout } from "./layout/AppLayout";
import { TenantsPage } from "./modules/tenants/TenantsPage";

function App() {
  const { data: sessionData, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm font-semibold text-muted-foreground animate-pulse">
          Lade Session...
        </p>
      </div>
    );
  }

  if (!sessionData) {
    return <Login onSuccess={() => window.location.reload()} />;
  }

  const user = sessionData.user;
  // @ts-ignore - custom field role on user object
  const isPlatformAdmin = user.role === "platform_admin";
  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  };

  if (!isPlatformAdmin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-2xl font-bold text-destructive">Zugriff verweigert</h1>
        <p className="max-w-md text-muted-foreground">
          Dieser Bereich ist ausschließlich für Plattform-Administratoren reserviert. 
          Dein Account ({user.email}) verfügt nicht über die erforderlichen Rechte.
        </p>
        <button
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={handleLogout}
        >
          Abmelden
        </button>
      </div>
    );
  }

  return (
    <AppLayout currentUser={{ email: user.email, name: user.name, role: "platform_admin" }} onLogout={handleLogout}>
      <TenantsPage />
    </AppLayout>
  );
}

export default App;
