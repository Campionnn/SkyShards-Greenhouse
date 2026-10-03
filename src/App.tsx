import { createBrowserRouter, RouterProvider, Navigate, useSearchParams } from "react-router-dom";
import { Suspense, lazy } from "react";
import { Layout } from "./components";
import { GridStateProvider, GreenhouseDataProvider, LockedPlacementsProvider, DesignerProvider, InfoModalProvider } from "./context";
import { usePageTitle, usePreloadGroundImages } from "./hooks";
import { ToastProvider } from "./components";
import { CropMutationInfoModal } from "./components/calculator/CropMutationInfoModal";

const CalculatorPage = lazy(() => import("./pages/CalculatorPage").then((module) => ({ default: module.CalculatorPage })));
const DesignerPage = lazy(() => import("./pages/DesignerPage").then((module) => ({ default: module.DesignerPage })));
const SimulatorPage = lazy(() => import("./pages/SimulatorPage").then((module) => ({ default: module.SimulatorPage })));
const AboutPage = lazy(() => import("./pages/AboutPage").then((module) => ({ default: module.AboutPage })));
const ContactPage = lazy(() => import("./pages/ContactPage").then((module) => ({ default: module.ContactPage })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const WikiPage = lazy(() => import("./pages/WikiPage").then((module) => ({ default: module.WikiPage })));
const ShortLinkRedirect = lazy(() => import("./pages/ShortLinkRedirect").then((module) => ({ default: module.ShortLinkRedirect })));

// Redirects /?layout=X to /designer?layout=X; otherwise renders the calculator.
const IndexRouteWithRedirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const layoutCode = searchParams.get("layout");
  
  if (layoutCode) {
    return <Navigate to={`/designer?layout=${layoutCode}`} replace />;
  }
  
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <CalculatorPage />
    </Suspense>
  );
};

const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-12">
    <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
  </div>
);

const AppWithProviders = () => {
  usePageTitle();
  usePreloadGroundImages();
  return <Layout />;
};

const ProtectedLayout = () => {
  return (
    <GreenhouseDataProvider>
      <GridStateProvider>
        <LockedPlacementsProvider>
          <DesignerProvider>
            <InfoModalProvider>
              <AppWithProviders />
              <CropMutationInfoModal />
            </InfoModalProvider>
          </DesignerProvider>
        </LockedPlacementsProvider>
      </GridStateProvider>
    </GreenhouseDataProvider>
  );
};

const router = createBrowserRouter([
  {
    path: "/",
    element: <ProtectedLayout />,
    children: [
      {
        index: true,
        element: <IndexRouteWithRedirect />,
      },
      {
        path: "designer",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <DesignerPage />
          </Suspense>
        ),
      },
      {
        path: "simulator",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <SimulatorPage />
          </Suspense>
        ),
      },
      {
        path: "wiki",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <WikiPage />
          </Suspense>
        ),
      },
      {
        path: "wiki/:slug",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <WikiPage />
          </Suspense>
        ),
      },
      {
        path: "about",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <AboutPage />
          </Suspense>
        ),
      },
      {
        path: "contact",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <ContactPage />
          </Suspense>
        ),
      },
      {
        path: "privacy-policy",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <PrivacyPolicy />
          </Suspense>
        ),
      },
      {
        // /gloomgourd -> /wiki/gloomgourd; any other unknown path -> /.
        path: "*",
        element: (
          <Suspense fallback={<LoadingSpinner />}>
            <ShortLinkRedirect />
          </Suspense>
        ),
      },
    ],
  },
]);

const App = () => {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
};

export default App;
