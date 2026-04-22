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
	// Use go-tpm-tools client
	sel := tpm2.PCRSelection{
		Hash: tpm2.AlgSHA256,
		PCRs: []int{pcrIndex},
	}
	pcrs, err := client.ReadPCRs(rwc, sel)
	if err == nil && len(pcrs.Pcrs) > 0 {
		if val, ok := pcrs.Pcrs[uint32(pcrIndex)]; ok {
			return "sha256:" + hex.EncodeToString(val), nil
		}
	}

	// Fallback: raw tpm2 command
	sel2 := tpm2.PCRSelection{
		Hash: tpm2.AlgSHA256,
		PCRs: []int{pcrIndex},
	}
	val, err := tpm2.ReadPCRs(rwc, sel2)
	if err != nil {
		return "", fmt.Errorf("tpm2.ReadPCRs: %w", err)
	}
	return "sha256:" + hex.EncodeToString(val[pcrIndex]), nil
}
