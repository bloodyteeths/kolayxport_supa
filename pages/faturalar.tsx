import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Box,
  Button,
} from '@mui/material';
import {
  GetApp,
  Visibility,
  ArrowBack,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import Layout from '../components/AppLayout';
import { useRouter } from 'next/router';

interface Invoice {
  id: string;
  date: string;
  amount: number;
  currency: string;
  status: string;
  hostedInvoiceUrl: string;
  invoicePdf: string;
  description: string;
  period: {
    start: string | null;
    end: string | null;
  };
}

export default function FaturalarPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBillingHistory();
  }, []);

  const fetchBillingHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get('/api/stripe/billing-history');
      setInvoices(response.data.invoices);
    } catch (err: any) {
      console.error('Failed to fetch billing history:', err);
      setError(err.response?.data?.error || 'Fatura geçmişi yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency === 'TRY' ? 'TRY' : 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'dd MMMM yyyy', { locale: tr });
  };

  if (loading) {
    return (
      <Layout>
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
            <CircularProgress />
          </Box>
        </Container>
      </Layout>
    );
  }

  return (
    <Layout>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <IconButton onClick={() => router.push('/ayarlar')} sx={{ mr: 2 }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 'bold', fontSize: { xs: '1.25rem', sm: '1.5rem', md: '2rem' } }}>
            Fatura Geçmişi
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Paper elevation={3}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ px: { xs: 1, sm: 2 } }}><strong>Fatura Tarihi</strong></TableCell>
                  <TableCell sx={{ px: { xs: 1, sm: 2 } }}><strong>Açıklama</strong></TableCell>
                  <TableCell sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}><strong>Hizmet Dönemi</strong></TableCell>
                  <TableCell sx={{ px: { xs: 1, sm: 2 } }}><strong>Tutar</strong></TableCell>
                  <TableCell sx={{ px: { xs: 1, sm: 2 } }}><strong>Durum</strong></TableCell>
                  <TableCell sx={{ px: { xs: 1, sm: 2 } }}><strong>İşlemler</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography variant="body1" color="text.secondary">
                        Henüz fatura geçmişiniz bulunmamaktadır.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell sx={{ px: { xs: 1, sm: 2 } }}>
                        {formatDate(invoice.date)}
                      </TableCell>
                      <TableCell sx={{ px: { xs: 1, sm: 2 } }}>
                        {invoice.description}
                      </TableCell>
                      <TableCell sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}>
                        {invoice.period.start && invoice.period.end ? (
                          <>
                            {formatDate(invoice.period.start)} - {formatDate(invoice.period.end)}
                          </>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell sx={{ px: { xs: 1, sm: 2 } }}>
                        <Typography variant="body2" fontWeight="bold">
                          {formatCurrency(invoice.amount, invoice.currency)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ px: { xs: 1, sm: 2 } }}>
                        <Chip
                          label={invoice.status === 'paid' ? 'Ödendi' : invoice.status}
                          color={invoice.status === 'paid' ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell sx={{ px: { xs: 1, sm: 2 } }}>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          {invoice.hostedInvoiceUrl && (
                            <IconButton
                              size="small"
                              onClick={() => window.open(invoice.hostedInvoiceUrl, '_blank')}
                              title="Faturayı Görüntüle"
                            >
                              <Visibility />
                            </IconButton>
                          )}
                          {invoice.invoicePdf && (
                            <IconButton
                              size="small"
                              onClick={() => window.open(invoice.invoicePdf, '_blank')}
                              title="PDF İndir"
                            >
                              <GetApp />
                            </IconButton>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        {invoices.length === 0 && !error && (
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Henüz bir aboneliğiniz bulunmamaktadır.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              onClick={() => router.push('/fiyatlandirma')}
            >
              Planları Görüntüle
            </Button>
          </Box>
        )}
      </Container>
    </Layout>
  );
}