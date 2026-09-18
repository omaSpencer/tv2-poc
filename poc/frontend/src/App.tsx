import { RouterProvider, createBrowserRouter } from 'react-router';
import { appRoutes } from './appRoutes';

const router = createBrowserRouter(appRoutes);

export default function App() {
  return <RouterProvider router={router} />;
}
