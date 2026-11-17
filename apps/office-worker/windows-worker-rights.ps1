# Dot-source from the reviewed elevated installer. This file does not alter policy
# until GrantOfficeWorkerRights is called for the dedicated local worker SID.
function GrantOfficeWorkerRights {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Sid)

    $officePrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$officePrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Elevation is required to provision the dedicated worker account rights.'
    }
    $officeSid = [Security.Principal.SecurityIdentifier]::new($Sid)
    $officeAccount = $officeSid.Translate([Security.Principal.NTAccount]).Value
    if ($officeAccount -ine "$env:COMPUTERNAME\EnztronicOfficeSvc") {
        throw 'Account rights can be assigned only to the dedicated local EnztronicOfficeSvc identity.'
    }
    if (!('Enztronic.OfficeWorkerRights' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace Enztronic {
 public static class OfficeWorkerRights {
  [StructLayout(LayoutKind.Sequential)] struct LSA_OBJECT_ATTRIBUTES {
   public uint Length; public IntPtr RootDirectory; public IntPtr ObjectName;
   public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
  }
  [StructLayout(LayoutKind.Sequential)] struct LSA_UNICODE_STRING {
   public ushort Length; public ushort MaximumLength; public IntPtr Buffer;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ConvertStringSidToSid(string sid, out IntPtr result);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system,
   ref LSA_OBJECT_ATTRIBUTES attributes, uint desiredAccess, out IntPtr policy);
  [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr policy,
   IntPtr sid, LSA_UNICODE_STRING[] rights, uint count);
  [DllImport("advapi32.dll")] static extern uint LsaEnumerateAccountRights(IntPtr policy,
   IntPtr sid, out IntPtr rights, out uint count);
  [DllImport("advapi32.dll")] static extern uint LsaNtStatusToWinError(uint status);
  [DllImport("advapi32.dll")] static extern uint LsaFreeMemory(IntPtr memory);
  [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr policy);
  static void Check(uint status) {
   if(status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status),
    "Office worker rights operation failed (NTSTATUS 0x"+status.ToString("X8")+").");
  }
  public static string[] Grant(string sidText) {
   string[] names = {"SeBatchLogonRight", "SeDenyInteractiveLogonRight", "SeDenyRemoteInteractiveLogonRight"};
   IntPtr sid=IntPtr.Zero, policy=IntPtr.Zero, allocatedRights=IntPtr.Zero;
   var nativeRights=new LSA_UNICODE_STRING[names.Length];
   try {
    if(!ConvertStringSidToSid(sidText,out sid)) throw new Win32Exception(Marshal.GetLastWin32Error());
    var attrs=new LSA_OBJECT_ATTRIBUTES(); attrs.Length=(uint)Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));
    Check(LsaOpenPolicy(IntPtr.Zero,ref attrs,0x00000810,out policy)); // LOOKUP_NAMES | CREATE_ACCOUNT
    for(int i=0;i<names.Length;i++) {
     nativeRights[i].Buffer=Marshal.StringToHGlobalUni(names[i]);
     nativeRights[i].Length=checked((ushort)(names[i].Length*2));
     nativeRights[i].MaximumLength=checked((ushort)((names[i].Length+1)*2));
    }
    Check(LsaAddAccountRights(policy,sid,nativeRights,(uint)nativeRights.Length));
    uint count; Check(LsaEnumerateAccountRights(policy,sid,out allocatedRights,out count));
    var result=new List<string>(); int size=Marshal.SizeOf(typeof(LSA_UNICODE_STRING));
    for(uint i=0;i<count;i++) {
     var right=(LSA_UNICODE_STRING)Marshal.PtrToStructure(IntPtr.Add(allocatedRights,checked((int)i*size)),typeof(LSA_UNICODE_STRING));
     result.Add(Marshal.PtrToStringUni(right.Buffer,right.Length/2));
    }
    foreach(string name in names) if(!result.Contains(name)) throw new InvalidOperationException("Required worker account right was not verified.");
    if(result.Contains("SeDenyBatchLogonRight")) throw new InvalidOperationException("A batch-logon denial conflicts with worker startup.");
    result.Sort(StringComparer.Ordinal); return result.ToArray();
   } finally {
    if(allocatedRights!=IntPtr.Zero) LsaFreeMemory(allocatedRights);
    for(int i=0;i<nativeRights.Length;i++) if(nativeRights[i].Buffer!=IntPtr.Zero) Marshal.FreeHGlobal(nativeRights[i].Buffer);
    if(policy!=IntPtr.Zero) LsaClose(policy);
    if(sid!=IntPtr.Zero) LocalFree(sid);
   }
  }
 }
}
'@
    }
    $officeRights = @([Enztronic.OfficeWorkerRights]::Grant($officeSid.Value))
    [pscustomobject]@{ Sid = $officeSid.Value; Rights = $officeRights; Verified = $true }
}
