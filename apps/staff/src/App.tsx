import { useState } from "react";

import { AppLayout } from "./layout/AppLayout";
import { defaultView, type AppView } from "./layout/navigation";
import { OwnerCatalogPage } from "./modules/owner/catalog/OwnerCatalogPage";
import { ModulePlaceholder } from "./modules/placeholder/ModulePlaceholder";

function App() {
  const [view, setView] = useState<AppView>(defaultView);

  return (
    <AppLayout onNavigate={setView} view={view}>
      {view.module === "owner" ? (
        <OwnerCatalogPage section={view.ownerSection} />
      ) : (
        <ModulePlaceholder module={view.module} />
      )}
    </AppLayout>
  );
}

export default App;
