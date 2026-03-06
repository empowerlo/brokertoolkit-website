module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { 
    email, firstName, lastName, companyName,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, gbraid, msclkid, twclid
  } = req.body || {};

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'email, firstName, and lastName are required' });
  }

  const apiKey = process.env.TRIAL_SIGNUP_API_KEY;
  if (!apiKey) {
    console.error('TRIAL_SIGNUP_API_KEY is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Build payload with form data + tracking parameters (filter out empty strings)
  const payload = {
    email: String(email).trim(),
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    companyName: companyName ? String(companyName).trim() : '',
    // UTM parameters
    ...(utm_source && { utm_source: String(utm_source).trim() }),
    ...(utm_medium && { utm_medium: String(utm_medium).trim() }),
    ...(utm_campaign && { utm_campaign: String(utm_campaign).trim() }),
    ...(utm_content && { utm_content: String(utm_content).trim() }),
    ...(utm_term && { utm_term: String(utm_term).trim() }),
    // Platform-specific click IDs
    ...(fbclid && { fbclid: String(fbclid).trim() }),
    ...(gclid && { gclid: String(gclid).trim() }),
    ...(gbraid && { gbraid: String(gbraid).trim() }),
    ...(msclkid && { msclkid: String(msclkid).trim() }),
    ...(twclid && { twclid: String(twclid).trim() })
  };

  try {
    // Send to internal system
    const upstream = await fetch('https://my.brokertoolkit.app/api/trial-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(payload)
    });

    const text = await upstream.text();
    let data;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!upstream.ok) {
      console.error('Trial signup upstream failed', upstream.status, data);
      return res.status(upstream.status).json({
        error: 'Trial signup failed',
        upstreamStatus: upstream.status,
        details: data
      });
    }

    // Send to LeadConnectorHQ webhook (with timeout, won't block on failure)
    const webhookUrl = 'https://services.leadconnectorhq.com/hooks/AXcZvDtotVT7XNDCDYJp/webhook-trigger/66fb7eb5-8026-46df-9837-78937037343c';
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      
      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      const webhookData = await webhookRes.text();
      console.log(`LeadConnectorHQ webhook (${webhookRes.status}):`, webhookData);
    } catch (err) {
      console.error('LeadConnectorHQ webhook error:', err.message);
      // Don't fail the form submission if webhook fails
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('Trial signup proxy error:', err.message);
    return res.status(502).json({ error: 'Unable to submit trial signup' });
  }
};
