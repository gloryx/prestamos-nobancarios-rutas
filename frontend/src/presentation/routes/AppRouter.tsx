import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { CantonsPage } from '../pages/CantonsPage';
import { CustomerStatisticsPage } from '../pages/CustomerStatisticsPage';
import { CustomerDetailPage } from '../pages/CustomerDetailPage';
import { CustomerEditPage } from '../pages/CustomerEditPage';
import { CustomersPage } from '../pages/CustomersPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DistrictsPage } from '../pages/DistrictsPage';
import { FinancialAnalysisPage } from '../pages/FinancialAnalysisPage';
import { NewCustomerPage } from '../pages/NewCustomerPage';
import { PaymentFrequenciesPage } from '../pages/PaymentFrequenciesPage';
import { PaymentMethodsPage } from '../pages/PaymentMethodsPage';
import { ProvincesPage } from '../pages/ProvincesPage';
import { RolesPage } from '../pages/RolesPage';
import { RoutesPage } from '../pages/RoutesPage';
import { UsersPage } from '../pages/UsersPage';
import { LoginPage } from '../pages/LoginPage';
import { CollectorCustomersPage } from '../pages/CollectorCustomersPage';
import { CollectorsPage } from '../pages/CollectorsPage';
import { AuthProvider } from '../hooks/useAuth';
import { RouteGuard } from '../components/auth/RouteGuard';
import { FinancialOpeningPage } from '../pages/FinancialOpeningPage';
import { CashMovementsPage } from '../pages/CashMovementsPage';
import { LoansPage } from '../pages/LoansPage';
import { CancelledLoansPage } from '../pages/CancelledLoansPage';
import { LoanManagementPage } from '../pages/LoanManagementPage';
import { LoanAnnulmentManagementPage } from '../pages/LoanAnnulmentManagementPage';
import { LoanDetailPage } from '../pages/LoanDetailPage';
import { NewLoanPage } from '../pages/NewLoanPage';
import { PaymentsPage } from '../pages/PaymentsPage';

export function AppRouter(): ReactElement {
  return <BrowserRouter><AuthProvider><Routes><Route path="/login" element={<LoginPage />} /><Route element={<RouteGuard><AppLayout /></RouteGuard>}>
    <Route path="/" element={<Navigate to="/dashboard" replace />} />
    <Route path="/dashboard" element={<DashboardPage />} />
    <Route path="/users" element={<RouteGuard permission="users.view"><UsersPage /></RouteGuard>} />
    <Route path="/roles" element={<RouteGuard permission="roles.view"><RolesPage /></RouteGuard>} />
    <Route path="/customers/financial-analysis" element={<RouteGuard permission="customers.analysis.view"><FinancialAnalysisPage /></RouteGuard>} />
    <Route path="/customers/statistics" element={<RouteGuard permission="customers.statistics.view"><CustomerStatisticsPage /></RouteGuard>} />
    <Route path="/customers/new" element={<RouteGuard permission="customers.create"><NewCustomerPage /></RouteGuard>} />
    <Route path="/customers/:id/edit" element={<RouteGuard permission="customers.update"><CustomerEditPage /></RouteGuard>} />
    <Route path="/customers/:id" element={<RouteGuard permission="customers.view"><CustomerDetailPage /></RouteGuard>} />
     <Route path="/customers" element={<RouteGuard permission="customers.view"><CustomersPage /></RouteGuard>} />
     <Route path="/collector/customers" element={<RouteGuard permission="customers.assigned.view"><CollectorCustomersPage /></RouteGuard>} />
     <Route path="/collectors" element={<RouteGuard permission="collectors.view"><CollectorsPage /></RouteGuard>} />
    <Route path="/settings/provinces" element={<RouteGuard permission="territorial.view"><ProvincesPage /></RouteGuard>} />
    <Route path="/settings/cantons" element={<RouteGuard permission="territorial.view"><CantonsPage /></RouteGuard>} />
    <Route path="/settings/districts" element={<RouteGuard permission="territorial.view"><DistrictsPage /></RouteGuard>} />
    <Route path="/settings/payment-methods" element={<RouteGuard permission="payment-methods.view"><PaymentMethodsPage /></RouteGuard>} />
    <Route path="/settings/payment-frequencies" element={<RouteGuard permission="payment-frequencies.view"><PaymentFrequenciesPage /></RouteGuard>} />
     <Route path="/settings/routes" element={<RouteGuard permission="routes.view"><RoutesPage /></RouteGuard>} />
      <Route path="/settings/financial-opening" element={<RouteGuard permission="financial-opening.view"><FinancialOpeningPage /></RouteGuard>} />
       <Route path="/finance/cash-movements" element={<RouteGuard permission="cash-movements.view"><CashMovementsPage /></RouteGuard>} />
     <Route path="/loans/new" element={<RouteGuard permission="loans.create"><NewLoanPage /></RouteGuard>} />
      <Route path="/loans/cancelled" element={<RouteGuard permission="loans.view"><CancelledLoansPage /></RouteGuard>} />
      <Route path="/loans/uncollectible-management" element={<RouteGuard permission="loans.view"><LoanManagementPage /></RouteGuard>} />
      <Route path="/loans/annulments" element={<RouteGuard permission="loans.view"><LoanAnnulmentManagementPage /></RouteGuard>} />
     <Route path="/loans/:id" element={<RouteGuard permission="loans.view"><LoanDetailPage /></RouteGuard>} />
      <Route path="/loans" element={<RouteGuard permission="loans.view"><LoansPage /></RouteGuard>} />
       <Route path="/payments" element={<Navigate to="/payments/new" replace />} />
       <Route path="/payments/new" element={<RouteGuard permission="payments.view"><PaymentsPage /></RouteGuard>} />
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Route></Routes></AuthProvider></BrowserRouter>;
}
