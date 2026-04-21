const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, firstName, lastName, companyName, offer, partnerId, ...attribution } = req.body || {};

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'email, firstName, and lastName are required' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  const stripe = Stripe(secretKey);

  try {
    // Check for existing customer with this email to prevent duplicates
    const existing = await stripe.customers.list({ email: email.trim(), limit: 1 });
    if (existing.data.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Create customer
    const customer = await stripe.customers.create({
      email: email.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      metadata: {
        companyName: companyName || '',
        offer: offer || 'aim-7day',
        partnerId: partnerId || 'aime',
        utm_source: attribution.utm_source || '',
        utm_medium: attribution.utm_medium || '',
        utm_campaign: attribution.utm_campaign || '',
        utm_content: attribution.utm_content || '',
        utm_term: attribution.utm_term || '',
        fbclid: attribution.fbclid || '',
        gclid: attribution.gclid || '',
      }
    });

    // Create PaymentIntent for $7 (700 cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 700,
      currency: 'usd',
      customer: customer.id,
      description: 'AIME Member Offer — Broker Toolkit 30-day intro ($7)',
      receipt_email: email.trim(),
      metadata: {
        offer: offer || 'aim-7day',
        partnerId: partnerId || 'aime',
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName || '',
        customerId: customer.id,
      }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('create-payment-intent error:', err);
    return res.status(500).json({ error: err.message || 'Failed to initialize payment.' });
  }
};
