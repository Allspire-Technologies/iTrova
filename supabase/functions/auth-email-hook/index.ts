import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { parseEmailWebhookPayload } from "npm:@lovable.dev/email-js";
import {
  WebhookError,
  verifyWebhookRequest,
} from "npm:@lovable.dev/webhooks-js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignupEmail } from "../_shared/email-templates/signup.tsx";
import { RecoveryEmail } from "../_shared/email-templates/recovery.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: "Welcome to iTrova — confirm your account",
  recovery: "Reset your iTrova password",
};

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  recovery: RecoveryEmail,
};

// Configuration
const SITE_NAME = "iTrova";
const SENDER_DOMAIN = "notify.itrova.allspire.tech";
const ROOT_DOMAIN = "itrova.allspire.tech";
const FROM_DOMAIN = "itrova.allspire.tech";

const SAMPLE_PROJECT_URL = "https://itrova.allspire.tech";
const SAMPLE_EMAIL = "user@example.test";
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
    businessName: "Sunrise Stores",
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
};

async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: previewCorsHeaders });
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const authHeader = req.headers.get("Authorization");

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...previewCorsHeaders, "Content-Type": "application/json" },
    });
  }

  let type: string;
  try {
    const body = await req.json();
    type = body.type;
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      {
        status: 400,
        headers: { ...previewCorsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const EmailTemplate = EMAIL_TEMPLATES[type];

  if (!EmailTemplate) {
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${type}` }),
      {
        status: 400,
        headers: { ...previewCorsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const sampleData = SAMPLE_DATA[type] || {};
  const html = await renderAsync(
    React.createElement(EmailTemplate, sampleData),
  );

  return new Response(html, {
    status: 200,
    headers: {
      ...previewCorsHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

async function handleWebhook(req: Request): Promise<Response> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!apiKey) {
    console.error("LOVABLE_API_KEY not configured");
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let payload: any;
  let run_id = "";
  try {
    const verified = await verifyWebhookRequest({
      req,
      secret: apiKey,
      parser: parseEmailWebhookPayload,
    });
    payload = verified.payload;
    run_id = payload.run_id;
  } catch (error) {
    if (error instanceof WebhookError) {
      switch (error.code) {
        case "invalid_signature":
        case "missing_timestamp":
        case "invalid_timestamp":
        case "stale_timestamp":
          console.error("Invalid webhook signature", { error: error.message });
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        case "invalid_payload":
        case "invalid_json":
          console.error("Invalid webhook payload", { error: error.message });
          return new Response(
            JSON.stringify({ error: "Invalid webhook payload" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
      }
    }

    console.error("Webhook verification failed", { error });
    return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!run_id) {
    return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (payload.version !== "1") {
    return new Response(
      JSON.stringify({
        error: `Unsupported payload version: ${payload.version}`,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const emailType = payload.data.action_type;
  console.log("Received auth event", {
    emailType,
    email: payload.data.email,
    run_id,
  });

  const EmailTemplate = EMAIL_TEMPLATES[emailType];
  if (!EmailTemplate) {
    // Silently skip unsupported auth events (invite, magiclink, email_change, reauthentication).
    console.log("Skipping unsupported email type", { emailType, run_id });
    return new Response(
      JSON.stringify({ success: true, skipped: true, emailType }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const userMeta = (payload.user?.user_metadata ??
    payload.data.user?.user_metadata ??
    {}) as Record<string, unknown>;
  const businessName =
    (typeof userMeta.business_name === "string" && userMeta.business_name) ||
    (typeof userMeta.businessName === "string" && userMeta.businessName) ||
    undefined;

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: payload.data.email,
    confirmationUrl: payload.data.url,
    token: payload.data.token,
    email: payload.data.email,
    businessName,
  };

  const html = await renderAsync(
    React.createElement(EmailTemplate, templateProps),
  );
  const text = await renderAsync(
    React.createElement(EmailTemplate, templateProps),
    {
      plainText: true,
    },
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const messageId = crypto.randomUUID();

  await supabase.from("email_send_log").insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: payload.data.email,
    status: "pending",
  });

  const { error: enqueueError } = await supabase.rpc("enqueue_email", {
    queue_name: "auth_emails",
    payload: {
      run_id,
      message_id: messageId,
      to: payload.data.email,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || "Notification",
      html,
      text,
      purpose: "transactional",
      label: emailType,
      queued_at: new Date().toISOString(),
    },
  });

  if (enqueueError) {
    console.error("Failed to enqueue auth email", {
      error: enqueueError,
      run_id,
      emailType,
    });
    await supabase.from("email_send_log").insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: payload.data.email,
      status: "failed",
      error_message: "Failed to enqueue email",
    });
    return new Response(JSON.stringify({ error: "Failed to enqueue email" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("Auth email enqueued", {
    emailType,
    email: payload.data.email,
    run_id,
  });

  return new Response(JSON.stringify({ success: true, queued: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (url.pathname.endsWith("/preview")) {
    return handlePreview(req);
  }

  try {
    return await handleWebhook(req);
  } catch (error) {
    console.error("Webhook handler error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
