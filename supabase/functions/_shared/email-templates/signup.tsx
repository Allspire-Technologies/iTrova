/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

import { main, container, brandBar, brandMark, h1, text, button, footer, hr } from './_styles.ts'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
  businessName?: string
}

export const SignupEmail = ({
  siteName,
  businessName,
  confirmationUrl,
}: SignupEmailProps) => {
  const greetingName = businessName?.trim()
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {greetingName ? `Welcome to ${siteName}, ${greetingName} 🎉` : `Welcome to ${siteName} 🎉`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandBar}>
            <Text style={brandMark}>{siteName}</Text>
          </Section>
          <Heading style={h1}>
            {greetingName ? `Welcome to ${siteName}, ${greetingName}! 🎉` : `Welcome to ${siteName}! 🎉`}
          </Heading>
          <Text style={text}>
            We're so glad you're here{greetingName ? `, and we can't wait to grow ${greetingName} with you` : ''}.
            {' '}{siteName} is built to help you run a calmer, sharper business. Track your stock, record
            every sale, manage your team, and see exactly how your shop is doing, all in one place.
          </Text>
          <Text style={text}>
            Tap the button below to activate your account and step inside.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Activate my account
          </Button>
          <Text style={text}>
            Once you're in, take a moment to add your first products and invite your team.
            We'll be right beside you as your business grows. 💚
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            Didn't create an {siteName} account? You can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default SignupEmail
