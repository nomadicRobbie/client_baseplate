import { Redirect } from 'expo-router';
import { getAccessToken } from '@/lib/session';

// Entry: send to the dashboard if there's a session, otherwise to login.
export default function Index() {
  return <Redirect href={getAccessToken() ? '/dashboard' : '/login'} />;
}
