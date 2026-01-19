import { Outlet, useNavigate, useLocation } from "react-router";

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isProducts = location.pathname.includes("/products");
  const isOrders = location.pathname.includes("/orders");

  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => navigate("/app/dashboard/products")}
          style={{
            marginRight: 10,
            fontWeight: isProducts ? "bold" : "normal",
          }}
        >
          Products
        </button>
        <button
          onClick={() => navigate("/app/dashboard/orders")}
          style={{
            fontWeight: isOrders ? "bold" : "normal",
          }}
        >
          Orders
        </button>
      </div>
      <Outlet />
    </div>
  );
}
