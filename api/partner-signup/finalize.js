const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    paymentIntentId,
    email,
    firstName,
    lastName,
    companyName,
    offer,
    partnerId,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    fbclid,
    gclid,
    gbraid,
    msclkid,
    twclid,
  } = req.body || {};

  if (!paymentIntentId || !email || !firstName || !lastName) {
    return res.status(400).json({ error: 'paymentIntentId, email, firstName, and lastName are required' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  const stripe = Stripe(secretKey);

  try {
    // Verify payment actually succeeded before proxying
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment has not been completed.' });
    }

    // Proxy to the main BT app's partner-signup/finalize endpoint.
    // That endpoint re-verifies the PaymentIntent with Stripe and handles everything:
    // user creation, subscription (active status, 30-day period, NOT trialing),
    // invoice record, payment method storage, GHL contact sync, LeadConnector webhook,
    // partner-branded welcome email.
    let provisioned = false;
    let accountExists = false;
    let redirectUrl = null;

    try {
      const btRes = await fetch('https://my.brokertoolkit.app/api/partner-signup/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          companyName: companyName || '',
          partnerId: partnerId || 'aime',
          paymentIntentId,
          // UTM / attribution
          utm_source: utm_source || 'aime',
          utm_medium: utm_medium || 'partner',
          utm_campaign: utm_campaign || 'aime-vendor-offer',
          utm_content: utm_content || '',
          utm_term: utm_term || '',
          fbclid: fbclid || '',
          gclid: gclid || '',
          gbraid: gbraid || '',
          msclkid: msclkid || '',
          twclid: twclid || '',
        }),
      });

      const btData = await btRes.json().catch(() => ({}));

      if (!btRes.ok) {
        console.error('BT partner-signup/finalize error:', btRes.status, btData);

        // 409 = account already exists — payment confirmed, they just need to log in
        if (btRes.status === 409) {
          accountExists = true;
        } else {
          // Payment succeeded but provisioning failed — flag for manual follow-up
          console.error('Provisioning failed for', email, '— manual action required');
        }
      } else {
        provisioned = true;
        redirectUrl = btData.redirectUrl || null;
      }
    } catch (proxyErr) {
      console.error('BT partner-signup proxy call failed:', proxyErr);
      // Payment confirmed; log and continue — ops can manually provision
    }

    if (accountExists) {
      return res.status(200).json({
        success: true,
        accountExists: true,
        message: 'Payment confirmed. An account with this email already exists — you can sign in at my.brokertoolkit.app.',
      });
    }

    return res.status(200).json({
      success: true,
      provisioned,
      redirectUrl,
      message: provisioned
        ? 'Payment confirmed and account created. Check your email for login details.'
        : 'Payment confirmed. Your account is being set up — you\'ll receive an email shortly. If you don\'t hear from us within 10 minutes, email support@brokertoolkit.app.',
    });
  } catch (err) {
    console.error('finalize error:', err);
    return res.status(500).json({ error: err.message || 'Account setup failed.' });
  }
};
