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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your {siteName} password</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>{siteName}</Text>
        </Section>
        <Heading style={h1}>Let's get you back in</Heading>
        <Text style={text}>
          We received a request to reset the password on your {siteName} account.
          Tap the button below to choose a new one. It only takes a moment.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Reset my password
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          Didn't request a reset? You can safely ignore this email. Your password stays the same.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
