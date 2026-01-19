// app/routes/app.jsx
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/* Optional: a nav that links to your child routes */}
      <ui-nav-menu>
        <a href="/app" rel="home">
          Home
        </a>
        <a href="/app/setup/step1">Setup step 1</a>
        <a href="/app/setup/step2">Setup step 2</a>
      </ui-nav-menu>

      {/* THIS is what renders your nested routes */}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch thrown responses
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
