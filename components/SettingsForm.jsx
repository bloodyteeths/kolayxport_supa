'use client';

import React, { useState } from 'react';
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import axios from 'axios';
import { useSession, signIn } from 'next-auth/react';
// import { useToast } from "@/components/ui/use-toast"; // Need to re-add toast or use alert

// Debug: Verify UI component imports are defined
if (typeof window !== 'undefined') {
  console.log('[DEBUG] SettingsForm UI imports', { Button, Input, Label, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle });
}

export default function SettingsForm() {
  // NextAuth session guard
  const { data: session, status } = useSession();
  if (status === 'loading') {
    return <p>Loading user info...</p>;
  }
  if (!session) {
    // Prompt sign-in if not authenticated
    return (
      <Card>
        <CardHeader>
          <CardTitle>Please Sign In</CardTitle>
          <CardDescription>You need to sign in to save your API keys.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => signIn('google')}>Sign in with Google</Button>
        </CardContent>
      </Card>
    );
  }
  // Now we have a valid session.user.id
  // const { data: session } = useSession(); // moved above
  // const { toast } = useToast(); // If using shadcn toast
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    VEEQO_API_KEY: '',
    TRENDYOL_SUPPLIER_ID: '',
    TRENDYOL_API_KEY: '',
    TRENDYOL_API_SECRET: '',
    SHIPPO_TOKEN: '', // Add SHIPPO_TOKEN if needed
    // Add FedEx keys if needed for label generation setup
    // FEDEX_ACCOUNT_NUMBER: '',
    // FEDEX_METER_NUMBER: '',
    // FEDEX_API_KEY: '',
    // FEDEX_SECRET_KEY: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    console.log("Saving settings:", formData);

    // Filter out empty keys before sending
    const keysToSave = Object.entries(formData)
      .filter(([key, value]) => value && value.trim() !== '')
      .reduce((obj, [key, value]) => {
        obj[key] = value.trim();
        return obj;
      }, {});

    if (Object.keys(keysToSave).length === 0) {
      alert('Please enter at least one API key.'); // Simple feedback
      // toast({ title: "Info", description: "Please enter at least one API key." });
      setIsLoading(false);
      return;
    }

    try {
      // Use axios to bypass fetch interceptor, include credentials and userId fallback
      const payload = {
        userId: session?.user?.id,
        ...keysToSave,
      };
      const axiosResponse = await axios.post(
        '/api/setScriptProps',
        payload,
        { withCredentials: true }
      );
      const result = axiosResponse.data;
       
      console.log("Settings saved successfully:", result);
      alert('Settings saved successfully!'); // Simple feedback
      // toast({ title: "Success", description: "Settings saved successfully!" });

    } catch (error) {
      console.error("Failed to save settings:", error);
      alert(`Failed to save settings: ${error.message}`); // Simple feedback
      // toast({ variant: "destructive", title: "Error", description: `Failed to save settings: ${error.message}` });
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to create input fields
  const renderInputField = (key, label, type = "text", placeholder = "") => (
    <div key={key} className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        name={key}
        type={type}
        value={formData[key]}
        onChange={handleChange}
        placeholder={placeholder || `Enter ${label}`}
        disabled={isLoading}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Key Settings</CardTitle>
        <CardDescription>
          Enter your API keys for the integrated services. These are stored securely
          in your personal Google Apps Script properties. The required keys for order sync are Veeqo and Trendyol.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {renderInputField("VEEQO_API_KEY", "Veeqo API Key")}
          {renderInputField("TRENDYOL_SUPPLIER_ID", "Trendyol Supplier ID")}
          {renderInputField("TRENDYOL_API_KEY", "Trendyol API Key")}
          {renderInputField("TRENDYOL_API_SECRET", "Trendyol API Secret", "password")}
          {renderInputField("SHIPPO_TOKEN", "Shippo API Token (Optional)", "password")}
          
          <hr className="my-4" />
          <h4 className="text-md font-medium mb-2">FedEx Settings (Optional)</h4>
          <p className="text-sm text-muted-foreground mb-3">Required only if you need FedEx label generation.</p>
          
          {renderInputField("FEDEX_ACCOUNT_NUMBER", "FedEx Account Number")}
          {renderInputField("FEDEX_METER_NUMBER", "FedEx Meter Number")}
          {renderInputField("FEDEX_API_KEY", "FedEx API Key (Web Services/REST)", "password")}
          {renderInputField("FEDEX_SECRET_KEY", "FedEx Secret Key (Web Services/REST)", "password")}
          {/* Note: FEDEX_FOLDER_ID is set during onboarding, not manually entered here */}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Kaydet & Uygula'} 
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
} 