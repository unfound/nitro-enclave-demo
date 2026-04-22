package tpm

import (
	"encoding/hex"
	"fmt"
	"io"
	"os"

	"github.com/google/go-tpm/legacy/tpm2"
	"github.com/google/go-tpm-tools/client"
)

// ReadPCRs reads the specified PCR indices and returns a map of index -> "algo:value".
// It tries go-tpm-tools client first, falls back to raw tpm2 commands.
func ReadPCRs(indices []int) (map[string]string, error) {
	path := os.Getenv("TPM_DEVICE")
	if path == "" {
		path = "/dev/tpm0"
	}

	rwc, err := tpm2.OpenTPM(path)
	if err != nil {
		return nil, fmt.Errorf("open TPM %s: %w", path, err)
	}
	defer rwc.Close()

	result := make(map[string]string)
	for _, idx := range indices {
		val, err := readPCRSingle(rwc, idx)
		if err != nil {
			return nil, fmt.Errorf("read PCR%d: %w", idx, err)
		}
		result[fmt.Sprintf("%d", idx)] = val
	}

	return result, nil
}

func readPCRSingle(rwc io.ReadWriteCloser, pcrIndex int) (string, error) {
	// Try go-tpm-tools client first
	pcrs, err := client.ReadPCRs(rwc, client.HashAlgoSHA256)
	if err == nil && len(pcrs) > 0 {
		if val, ok := pcrs[pcrIndex]; ok {
			return "sha256:" + hex.EncodeToString(val), nil
		}
	}

	// Fallback: raw tpm2 command
	sel := tpm2.PCRSelection{
		Hash: tpm2.AlgSHA256,
		PCRs: []int{pcrIndex},
	}
	val, err := tpm2.ReadPCR(rwc, uint32(pcrIndex), &sel)
	if err != nil {
		return "", fmt.Errorf("tpm2.ReadPCR: %w", err)
	}
	return "sha256:" + hex.EncodeToString(val), nil
}
